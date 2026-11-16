# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Python imports
import json
from uuid import UUID

# Django imports
from django.db import transaction
from django.db.models import Case, Count, Q, Value, When
from django.utils import timezone

# Module imports
from plane.bgtasks.issue_activities_task import issue_activity
from plane.db.models import (
    Issue,
    Project,
    ProjectIssueType,
    ProjectWorkflowScheme,
    ProjectWorkflowSchemeItem,
    State,
    StateGroup,
    Workflow,
    WorkflowState,
    WorkflowStatus,
    WorkflowTransitionSource,
)
from plane.utils.audit import record_audit
from plane.utils.exception_logger import log_exception


class SchemeError(Exception):
    def __init__(self, code, details=None):
        super().__init__(code)
        self.code = code
        self.details = details


def _canonical(identifier):
    return str(UUID(str(identifier)))


def _normalise(default_workflow_id, items):
    """Scheme identifiers as strings, so request data and ORM values compare equal."""
    return _canonical(default_workflow_id), {
        _canonical(type_id): _canonical(workflow_id) for type_id, workflow_id in items.items()
    }


def _type_filter(workflow_id, default_workflow_id, items):
    """Work items whose type follows workflow_id under a scheme of this default and these lines (strings)."""
    own = [type_id for type_id, item_workflow_id in items.items() if item_workflow_id == workflow_id]
    if workflow_id != default_workflow_id:
        return Q(type_id__in=own)
    others = [type_id for type_id, item_workflow_id in items.items() if item_workflow_id != workflow_id]
    # NOT IN drops null types, which follow the default workflow.
    return ~Q(type_id__in=others) | Q(type_id__isnull=True)


def _statuses_by_workflow(workflow_ids):
    result = {workflow_id: {} for workflow_id in workflow_ids}
    for workflow_id, status_id, name in WorkflowState.objects.filter(workflow_id__in=workflow_ids).values_list(
        "workflow_id", "status_id", "status__name"
    ):
        result[str(workflow_id)][str(status_id)] = name.lower()
    return result


def _drop_obsolete_states(project, kept_by_status):
    obsolete = State.objects.filter(project_id=project.id, workflow_status__isnull=False).exclude(
        workflow_status_id__in=kept_by_status.keys()
    )
    if Issue.objects.filter(state__in=obsolete).exists():
        raise SchemeError("status_in_use")
    Project.objects.filter(pk=project.pk, default_state__in=obsolete).update(default_state=None)
    obsolete.delete()


def sync_project_states(project, *, drop_obsolete=True):
    """W4, W17: exactly one managed project state per status of the scheme workflows; returns {status_id: State}."""
    scheme = ProjectWorkflowScheme.objects.get(project_id=project.id)
    workflow_ids = {scheme.default_workflow_id, *scheme.items.values_list("workflow_id", flat=True)}
    statuses = WorkflowStatus.objects.filter(workflow_states__workflow_id__in=workflow_ids).distinct()
    linked = {
        state.workflow_status_id: state
        for state in State.objects.filter(project_id=project.id, workflow_status__isnull=False)
    }
    # State.objects already hides the intake triage state.
    unmanaged = {
        state.name.lower(): state for state in State.objects.filter(project_id=project.id, workflow_status__isnull=True)
    }
    result = {}
    for status in statuses.order_by("sequence", "name"):
        state = linked.get(status.id) or unmanaged.pop(status.name.lower(), None)
        if state is None:
            state = State(project_id=project.id, workspace_id=project.workspace_id)
        values = {"name": status.name, "color": status.color, "group": status.group, "workflow_status_id": status.id}
        if state._state.adding or any(getattr(state, field) != value for field, value in values.items()):
            for field, value in values.items():
                setattr(state, field, value)
            state.save()
        result[status.id] = state
    # apply_scheme moves the items out of obsolete states first, then drops them itself.
    if drop_obsolete:
        _drop_obsolete_states(project, result)
    initial_status_id = (
        WorkflowState.objects.filter(workflow_id=scheme.default_workflow_id, is_initial=True)
        .values_list("status_id", flat=True)
        .get()
    )
    # One UPDATE so the project never has zero or two defaults.
    State.objects.filter(project_id=project.id).update(
        default=Case(When(pk=result[initial_status_id].pk, then=Value(True)), default=Value(False))
    )
    return result


def mapping_needs(project, default_workflow_id, items):
    """W10: (current state, target workflow) pairs holding work items whose status the target workflow lacks."""
    default_workflow_id, items = _normalise(default_workflow_id, items)
    statuses = _statuses_by_workflow({default_workflow_id, *items.values()})
    states = {state.pk: state for state in State.objects.filter(project_id=project.id)}
    rows = (
        Issue.objects.filter(project_id=project.id, state_id__in=states.keys())
        .values("state_id", "type_id")
        .annotate(count=Count("id"))
    )
    needs = {}
    for row in rows:
        workflow_id = items.get(str(row["type_id"]), default_workflow_id)
        state = states[row["state_id"]]
        if str(state.workflow_status_id) in statuses[workflow_id]:
            continue
        key = (str(state.pk), workflow_id)
        if key not in needs:
            # Only an unmanaged state is adopted by name; a managed one carries another status.
            auto = None
            if state.workflow_status_id is None:
                auto = next(
                    (status_id for status_id, name in statuses[workflow_id].items() if name == state.name.lower()), None
                )
            needs[key] = {
                "state_id": key[0],
                "state_name": state.name,
                "workflow_id": workflow_id,
                "issue_count": 0,
                "auto_status_id": auto,
            }
        needs[key]["issue_count"] += row["count"]
    return sorted(needs.values(), key=lambda need: (need["state_name"].lower(), need["workflow_id"]))


def validate_scheme(project, default_workflow_id, items):
    """Workflows of the project workspace with an initial state, types enabled in the project (invariant 4)."""
    default_workflow_id, items = _normalise(default_workflow_id, items)
    workflow_ids = {default_workflow_id, *items.values()}
    valid_workflows = (
        Workflow.objects.filter(pk__in=workflow_ids, workspace_id=project.workspace_id, states__is_initial=True)
        .distinct()
        .count()
    )
    enabled_types = ProjectIssueType.objects.filter(project_id=project.id, issue_type_id__in=items.keys()).count()
    if valid_workflows != len(workflow_ids) or enabled_types != len(items):
        raise SchemeError("invalid_scheme")


def _scheme_snapshot(scheme):
    if scheme is None:
        return None
    return {
        "default_workflow_id": str(scheme.default_workflow_id),
        "items": {
            str(type_id): str(workflow_id)
            for type_id, workflow_id in scheme.items.values_list("issue_type_id", "workflow_id")
        },
    }


def _save_scheme(project, default_workflow_id, items):
    scheme = ProjectWorkflowScheme.objects.filter(project_id=project.id).first()
    before = _scheme_snapshot(scheme)
    if scheme is None:
        scheme = ProjectWorkflowScheme.objects.create(
            project_id=project.id, workspace_id=project.workspace_id, default_workflow_id=default_workflow_id
        )
    elif str(scheme.default_workflow_id) != default_workflow_id:
        scheme.default_workflow_id = default_workflow_id
        scheme.save(update_fields=["default_workflow", "updated_at"])
    if _scheme_snapshot(scheme)["items"] != items:
        scheme.items.all().delete()
        ProjectWorkflowSchemeItem.objects.bulk_create(
            ProjectWorkflowSchemeItem(scheme=scheme, issue_type_id=type_id, workflow_id=workflow_id)
            for type_id, workflow_id in items.items()
        )
    return scheme, before


def _move_issues(project, planned, states_by_status, default_workflow_id, items):
    """System operation (T6): no transition check; the history is recorded once the transaction commits."""
    moves = []
    now = timezone.now()
    for need, arrival in planned:
        target = states_by_status[arrival]
        issue_ids = list(
            Issue.objects.filter(
                _type_filter(need["workflow_id"], default_workflow_id, items),
                project_id=project.id,
                state_id=need["state_id"],
            ).values_list("id", flat=True)
        )
        Issue.objects.filter(pk__in=issue_ids).update(
            state_id=target.pk,
            updated_at=now,
            completed_at=now if target.group == StateGroup.COMPLETED.value else None,
        )
        moves += [(issue_id, need["state_id"], target.pk) for issue_id in issue_ids]
    return moves


def _drop_unmanaged_states(project):
    leftovers = State.objects.filter(project_id=project.id, workflow_status__isnull=True)
    if Issue.objects.filter(state__in=leftovers).exists():
        raise SchemeError("mapping_incomplete")
    Project.objects.filter(pk=project.pk, default_state__in=leftovers).update(default_state=None)
    leftovers.delete()


def _record_moves(moves, project_id, actor_id):
    epoch = int(timezone.now().timestamp())
    for issue_id, old_state_id, new_state_id in moves:
        # The change is committed: a broker failure must not turn it into an error response.
        try:
            issue_activity.delay(
                type="issue.activity.updated",
                requested_data=json.dumps({"state_id": str(new_state_id)}),
                current_instance=json.dumps({"state_id": str(old_state_id)}),
                issue_id=str(issue_id),
                project_id=str(project_id),
                actor_id=str(actor_id),
                epoch=epoch,
                notification=False,
            )
        except Exception as error:
            log_exception(error)


def apply_scheme(*, project, default_workflow_id, items, mappings, actor_id):
    """Spec 5.1 step 3: attach or change the scheme and move work items as mapped, in one replayable transaction."""
    default_workflow_id, items = _normalise(default_workflow_id, items)
    mappings = {
        (_canonical(state_id), _canonical(workflow_id)): _canonical(status_id)
        for (state_id, workflow_id), status_id in mappings.items()
    }
    with transaction.atomic():
        # Lock order everywhere: workflows (id order) then projects; also serialises with a workflow DELETE.
        list(
            Workflow.objects.select_for_update(of=("self",))
            .filter(pk__in={default_workflow_id, *items.values()}, workspace_id=project.workspace_id)
            .order_by("id")
        )
        project = Project.objects.select_for_update(of=("self",)).get(pk=project.pk, archived_at__isnull=True)
        validate_scheme(project, default_workflow_id, items)
        statuses = _statuses_by_workflow({default_workflow_id, *items.values()})
        planned, missing = [], []
        for need in mapping_needs(project, default_workflow_id, items):
            arrival = mappings.get((need["state_id"], need["workflow_id"])) or need["auto_status_id"]
            if arrival is None:
                missing.append(need)
            elif arrival not in statuses[need["workflow_id"]]:
                raise SchemeError("invalid_mapping", [need])
            elif need["auto_status_id"] is None:
                planned.append((need, arrival))
        if missing:
            raise SchemeError("mapping_incomplete", missing)

        scheme, before = _save_scheme(project, default_workflow_id, items)
        # Linking first creates the target states; the moves then leave the old states empty.
        states = sync_project_states(project, drop_obsolete=False)
        moves = _move_issues(
            project, planned, {str(key): state for key, state in states.items()}, default_workflow_id, items
        )
        _drop_obsolete_states(project, states)
        _drop_unmanaged_states(project)
        after = _scheme_snapshot(scheme)
        if before != after or moves:
            record_audit(
                workspace_id=project.workspace_id,
                actor_id=actor_id,
                action="project_workflow_scheme.applied",
                target_type="project",
                target_id=project.id,
                before=before,
                after={**after, "moved_issue_count": len(moves)},
            )
        if moves:
            transaction.on_commit(lambda: _record_moves(moves, project.id, actor_id))
    return states


def detach_scheme(*, project, actor_id):
    """Spec 5.3: the project becomes free again; its states stay and lose their link."""
    with transaction.atomic():
        project = Project.objects.select_for_update(of=("self",)).get(pk=project.pk, archived_at__isnull=True)
        scheme = ProjectWorkflowScheme.objects.filter(project_id=project.id).first()
        if scheme is None:
            return False
        before = _scheme_snapshot(scheme)
        State.objects.filter(project_id=project.id).update(workflow_status=None)
        scheme.delete()
        record_audit(
            workspace_id=project.workspace_id,
            actor_id=actor_id,
            action="project_workflow_scheme.detached",
            target_type="project",
            target_id=project.id,
            before=before,
        )
        return True


def projects_using(workflow_id):
    return Project.objects.filter(
        Q(workflow_scheme__default_workflow_id=workflow_id) | Q(workflow_scheme__items__workflow_id=workflow_id)
    ).distinct()


def drop_type_lines(issue_type_id, project_id=None):
    """A type leaving a project (or the workspace) leaves its scheme too; the projects that lost a line re-sync."""
    lines = ProjectWorkflowSchemeItem.objects.filter(issue_type_id=issue_type_id)
    if project_id is not None:
        lines = lines.filter(scheme__project_id=project_id)
    project_ids = set(lines.values_list("scheme__project_id", flat=True))
    if not project_ids:
        return
    workflow_ids = {
        *ProjectWorkflowScheme.objects.filter(project_id__in=project_ids).values_list("default_workflow_id", flat=True),
        *ProjectWorkflowSchemeItem.objects.filter(scheme__project_id__in=project_ids).values_list(
            "workflow_id", flat=True
        ),
    }
    with transaction.atomic():
        # Same lock order as apply_scheme: workflows by id, then projects by id.
        list(Workflow.objects.select_for_update(of=("self",)).filter(pk__in=workflow_ids).order_by("id"))
        projects = list(Project.objects.select_for_update(of=("self",)).filter(pk__in=project_ids).order_by("id"))
        lines.filter(scheme__project_id__in=project_ids).delete()
        for project in projects:
            # A detach may have raced the removal.
            if ProjectWorkflowScheme.objects.filter(project_id=project.id).exists():
                sync_project_states(project)


def status_usage(workflow_id, status_ids):
    """W11: per linked project, the work items following this workflow that sit in these statuses."""
    usage = []
    schemes = (
        ProjectWorkflowScheme.objects.filter(Q(default_workflow_id=workflow_id) | Q(items__workflow_id=workflow_id))
        .distinct()
        .select_related("project")
        .order_by("project__name")
    )
    for scheme in schemes:
        items = dict(scheme.items.values_list("issue_type_id", "workflow_id"))
        count = Issue.objects.filter(
            _type_filter(workflow_id, scheme.default_workflow_id, items),
            project_id=scheme.project_id,
            state__workflow_status_id__in=status_ids,
        ).count()
        if count:
            usage.append(
                {"project_id": str(scheme.project_id), "project_name": scheme.project.name, "issue_count": count}
            )
    return usage


def deduce_groups(workflow_id):
    """W5, P4: re-derive the auto group of statuses this workflow alone uses; global transitions do not count."""
    with_exit = set(
        WorkflowTransitionSource.objects.filter(transition__workflow_id=workflow_id).values_list("source_id", flat=True)
    )
    changed = []
    for state in WorkflowState.objects.filter(workflow_id=workflow_id).select_related("status"):
        status = state.status
        if not status.group_is_auto or WorkflowState.objects.filter(status_id=status.id).count() > 1:
            continue
        if state.is_initial:
            group = StateGroup.UNSTARTED.value
        elif state.pk in with_exit:
            group = StateGroup.STARTED.value
        else:
            group = StateGroup.COMPLETED.value
        if status.group != group:
            status.group = group
            status.save(update_fields=["group", "updated_at"])
            changed.append(status)
    return changed


def propagate_statuses(statuses):
    """W17: a status edit reaches every project state mirroring it, in every project."""
    for status in statuses:
        State.objects.filter(workflow_status_id=status.id).update(
            name=status.name, color=status.color, group=status.group
        )


def resync_workflow(workflow_id):
    """Re-sync every project using the workflow, locking projects in id order like apply_scheme does."""
    with transaction.atomic():
        project_ids = list(projects_using(workflow_id).values_list("id", flat=True))
        for project in Project.objects.select_for_update(of=("self",)).filter(pk__in=project_ids).order_by("id"):
            # A detach may have raced the graph save.
            if ProjectWorkflowScheme.objects.filter(project_id=project.id).exists():
                sync_project_states(project)
