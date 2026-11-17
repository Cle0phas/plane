# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Python imports
import hashlib
import json

# Module imports
from plane.db.models import (
    WorkflowState,
    WorkflowStatus,
    WorkflowTransition,
    WorkflowTransitionRule,
    WorkflowTransitionSource,
)
from plane.db.models.workflow import MAX_STATUSES_PER_WORKSPACE
from plane.utils.audit import record_audit
from plane.utils.workflow_sync import (
    SchemeError,
    deduce_groups,
    projects_using,
    propagate_statuses,
    resync_workflow,
    status_usage,
)


class GraphError(Exception):
    def __init__(self, code, details=None):
        super().__init__(code)
        self.code = code
        self.details = details


def _status_data(status):
    return {
        "id": str(status.id),
        "name": status.name,
        "color": status.color,
        "group": status.group,
        "group_is_auto": status.group_is_auto,
    }


def workflow_graph(workflow):
    """The editor's view of a workflow, also used as the audit snapshot (W14)."""
    states = WorkflowState.objects.filter(workflow_id=workflow.id).select_related("status").order_by("created_at", "id")
    transitions = (
        WorkflowTransition.objects.filter(workflow_id=workflow.id)
        .prefetch_related("sources", "rules")
        .order_by("created_at", "id")
    )
    return {
        "id": str(workflow.id),
        "name": workflow.name,
        "description": workflow.description,
        "updated_at": workflow.updated_at.isoformat() if workflow.updated_at else None,
        "states": [
            {
                "id": str(state.id),
                "status": _status_data(state.status),
                "position_x": state.position_x,
                "position_y": state.position_y,
                "is_initial": state.is_initial,
            }
            for state in states
        ],
        "transitions": [
            {
                "id": str(transition.id),
                "name": transition.name,
                "from_any": transition.from_any,
                "source_ids": sorted(str(source.source_id) for source in transition.sources.all()),
                "sides": {
                    str(source.source_id): {"source": source.source_side, "target": source.target_side}
                    for source in transition.sources.all()
                    if source.source_side and source.target_side
                },
                "target_id": str(transition.target_id),
                "rules": [{"type": rule.rule_type, "params": rule.params} for rule in transition.rules.all()],
            }
            for transition in transitions
        ],
    }


def graph_version(graph):
    """Fingerprint of the states and transitions of a workflow_graph() result (spec 6.1)."""
    content = {"states": graph["states"], "transitions": graph["transitions"]}
    return hashlib.sha256(json.dumps(content, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def _lock_statuses(workflow, graph, existing):
    """Lock in one query, ordered by id, the statuses the request cites and those the workflow uses now."""
    ids = {str(state["status"]["id"]) for state in graph["states"] if "id" in state["status"]}
    ids.update(str(state.status_id) for state in existing.values())
    return {
        str(status.id): status
        for status in WorkflowStatus.objects.select_for_update(of=("self",))
        .filter(workspace_id=workflow.workspace_id, pk__in=ids)
        .order_by("id")
    }


def _resolve_statuses(workflow, graph, existing, locked):
    """Check the request may use the statuses it cites; returns {status id: WorkflowStatus}."""
    ids = [str(state["status"]["id"]) for state in graph["states"] if "id" in state["status"]]
    statuses = {status_id: locked[status_id] for status_id in ids if status_id in locked}
    if len(statuses) != len(ids):
        raise GraphError("invalid_status")
    for state in graph["states"]:
        current = existing.get(state["key"])
        if current is not None and str(current.status_id) != str(state["status"].get("id")):
            raise GraphError("status_changed")
    new_count = sum(1 for state in graph["states"] if "id" not in state["status"])
    if new_count and WorkflowStatus.objects.filter(workspace_id=workflow.workspace_id).count() + new_count > (
        MAX_STATUSES_PER_WORKSPACE
    ):
        raise GraphError("status_limit")
    return statuses


def _write_status(workflow, data, statuses):
    """Create the status, or apply the edit to the shared one (W17); returns (status, edited)."""
    group = data.get("group")
    if "id" not in data:
        status = WorkflowStatus.objects.create(
            workspace_id=workflow.workspace_id,
            name=data["name"],
            color=data["color"],
            group=group or "started",
            group_is_auto=group is None,
        )
        return status, False
    status = statuses[str(data["id"])]
    changes = {"name": data["name"], "color": data["color"]}
    if group is not None:
        changes.update(group=group, group_is_auto=False)
    if all(getattr(status, field) == value for field, value in changes.items()):
        return status, False
    for field, value in changes.items():
        setattr(status, field, value)
    # shortcut: swapping two status names in one save hits the unique constraint (P8), save twice instead.
    status.save()
    return status, True


def save_workflow_graph(*, workflow, graph, actor_id, expected_version=None):
    """P1: replace the graph of a locked workflow, then propagate to every linked project (5.2)."""
    existing = {str(state.id): state for state in WorkflowState.objects.filter(workflow_id=workflow.id)}
    locked = _lock_statuses(workflow, graph, existing)
    # Read under the locks: a shared status renamed from another workflow counts as a change (spec 6.1).
    before = workflow_graph(workflow)
    if expected_version is not None and graph_version(before) != expected_version:
        raise GraphError("stale_graph")
    # An empty graph would leave linked projects without an initial state.
    if not graph["states"] and projects_using(workflow.id).exists():
        raise GraphError("initial_state_required")
    statuses = _resolve_statuses(workflow, graph, existing, locked)
    keys = {state["key"] for state in graph["states"]}
    removed = [state for key, state in existing.items() if key not in keys]
    if removed:
        usage = status_usage(workflow.id, [state.status_id for state in removed])
        if usage:
            raise GraphError("status_in_use", usage)

    edited = {}
    status_by_key = {}
    for state in graph["states"]:
        status, was_edited = _write_status(workflow, state["status"], statuses)
        status_by_key[state["key"]] = status
        if was_edited:
            edited[status.id] = status

    WorkflowState.objects.filter(pk__in=[state.pk for state in removed]).delete()
    # Clear the initial flag first so the single-initial constraint holds while rows change.
    WorkflowState.objects.filter(workflow_id=workflow.id).update(is_initial=False)
    state_by_key = {}
    for state in graph["states"]:
        row = existing.get(state["key"]) or WorkflowState(workflow_id=workflow.id, status=status_by_key[state["key"]])
        row.position_x = state["position_x"]
        row.position_y = state["position_y"]
        row.is_initial = state["is_initial"]
        row.save()
        state_by_key[state["key"]] = row

    WorkflowTransition.objects.filter(workflow_id=workflow.id).delete()
    for item in graph["transitions"]:
        transition = WorkflowTransition.objects.create(
            workflow_id=workflow.id,
            target=state_by_key[item["target_key"]],
            name=item["name"],
            from_any=item["from_any"],
        )
        sides = item.get("sides", {})
        WorkflowTransitionSource.objects.bulk_create(
            WorkflowTransitionSource(
                transition=transition,
                source=state_by_key[key],
                source_side=sides.get(key, {}).get("source", ""),
                target_side=sides.get(key, {}).get("target", ""),
            )
            for key in item["source_keys"]
        )
        WorkflowTransitionRule.objects.bulk_create(
            WorkflowTransitionRule(transition=transition, rule_type=rule["type"], params=rule["params"])
            for rule in item["rules"]
        )

    for status in deduce_groups(workflow.id):
        edited[status.id] = status
    propagate_statuses(edited.values())
    try:
        resync_workflow(workflow.id)
    except SchemeError as error:
        raise GraphError(error.code, error.details) from error
    workflow.save(update_fields=["updated_at"])
    after = workflow_graph(workflow)
    record_audit(
        workspace_id=workflow.workspace_id,
        actor_id=actor_id,
        action="workflow.graph_updated",
        target_type="workflow",
        target_id=workflow.id,
        before=before,
        after=after,
    )
    return after
