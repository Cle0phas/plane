# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from plane.db.models import (
    Workflow,
    WorkflowState,
    WorkflowStatus,
    WorkflowTransition,
    WorkflowTransitionRule,
    WorkflowTransitionSource,
)
from plane.db.models.workflow import RULE_RESTRICT_ACTORS


def build_workflow(workspace, name, statuses, transitions=(), initial=None):
    """Create a workflow over shared statuses; transitions are (sources or "*", target, rule params or None)."""
    workflow = Workflow.objects.create(workspace=workspace, name=name)
    initial = initial or statuses[0]
    states = {}
    for index, status_name in enumerate(statuses):
        status = WorkflowStatus.objects.filter(workspace=workspace, name__iexact=status_name).first()
        if status is None:
            status = WorkflowStatus.objects.create(workspace=workspace, name=status_name, color="#3A3A3A")
        states[status_name] = WorkflowState.objects.create(
            workflow=workflow, status=status, is_initial=status_name == initial, position_x=index * 240
        )
    for sources, target, rule_params in transitions:
        transition = WorkflowTransition.objects.create(
            workflow=workflow, target=states[target], from_any=sources == "*"
        )
        if sources != "*":
            for source in sources:
                WorkflowTransitionSource.objects.create(transition=transition, source=states[source])
        if rule_params is not None:
            WorkflowTransitionRule.objects.create(
                transition=transition, rule_type=RULE_RESTRICT_ACTORS, params=rule_params
            )
    workflow.states_by_name = states
    return workflow


def link_project(project, default_workflow, items=None, actor=None):
    """Attach a scheme to a project holding no work item in a conflicting state; returns {state name: State}."""
    from plane.utils.workflow_sync import apply_scheme

    states = apply_scheme(
        project=project,
        default_workflow_id=default_workflow.id,
        items={issue_type.id: workflow.id for issue_type, workflow in (items or {}).items()},
        mappings={},
        # The audit trail needs a real actor; tests default to the workspace owner.
        actor_id=(actor.id if actor else project.workspace.owner_id),
    )
    return {state.name: state for state in states.values()}
