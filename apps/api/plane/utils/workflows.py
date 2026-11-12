# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Third party imports
from crum import get_current_user
from django.db.models import Q
from rest_framework import serializers

# Module imports
from plane.db.models import (
    IssueAssignee,
    ProjectIssueType,
    ProjectMember,
    ProjectWorkflowScheme,
    ProjectWorkflowSchemeItem,
    State,
    StateGroup,
    WorkflowState,
    WorkflowTransition,
)
from plane.db.models.workflow import RULE_RESTRICT_ACTORS

TRANSITION_NOT_ALLOWED = "transition_not_allowed"
ARRIVAL_STATE_REQUIRED = "arrival_state_required"


def refusal(code):
    """One body per refusal kind, whatever the cause, so a refusal reveals nothing of the configuration (4.5)."""
    return serializers.ValidationError({"workflow": [code]})


def workflow_id_for(project_id, type_id):
    """Spec 3.3: the type's workflow in the project scheme, else the scheme default; None for a free project."""
    scheme = ProjectWorkflowScheme.objects.filter(project_id=project_id).values("id", "default_workflow_id").first()
    if scheme is None:
        return None
    if type_id is not None:
        workflow_id = (
            ProjectWorkflowSchemeItem.objects.filter(scheme_id=scheme["id"], issue_type_id=type_id)
            .values_list("workflow_id", flat=True)
            .first()
        )
        if workflow_id is not None:
            return workflow_id
    return scheme["default_workflow_id"]


def project_default_type_id(project_id):
    return (
        ProjectIssueType.objects.filter(project_id=project_id, is_default=True)
        .values_list("issue_type_id", flat=True)
        .first()
    )


def state_in_workflow(state, workflow_id, project_id):
    return (
        state is not None
        and state.project_id == project_id
        and state.workflow_status_id is not None
        and WorkflowState.objects.filter(workflow_id=workflow_id, status_id=state.workflow_status_id).exists()
    )


def initial_state(project_id, workflow_id):
    """The project state mirroring the workflow's initial status (W7)."""
    status_id = (
        WorkflowState.objects.filter(workflow_id=workflow_id, is_initial=True)
        .values_list("status_id", flat=True)
        .first()
    )
    if status_id is None:
        return None
    return State.objects.filter(project_id=project_id, workflow_status_id=status_id).first()


def _actor_allowed(params, issue, actor):
    """W6: any one criterion admits the actor; workspace admins are not exempt."""
    if actor is None or not getattr(actor, "is_authenticated", False) or not isinstance(params, dict):
        return False
    actor_id = str(actor.id)
    user_ids = params.get("user_ids")
    if isinstance(user_ids, list) and actor_id in user_ids:
        return True
    if params.get("creator") is True and str(issue.created_by_id) == actor_id:
        return True
    if (
        params.get("assignee") is True
        and IssueAssignee.objects.filter(issue_id=issue.id, assignee_id=actor.id).exists()
    ):
        return True
    roles = params.get("roles")
    return (
        isinstance(roles, list)
        and bool(roles)
        and ProjectMember.objects.filter(
            project_id=issue.project_id, member_id=actor.id, is_active=True, role__in=roles
        ).exists()
    )


def _rule_allows(rule, issue, actor):
    if rule.rule_type == RULE_RESTRICT_ACTORS:
        return _actor_allowed(rule.params, issue, actor)
    # An unknown rule type fails closed.
    return False


def check_transition(issue, from_state, to_state, actor, workflow_id=None):
    """Spec 4.1: whether the issue's workflow lets actor move it from from_state to to_state."""
    if workflow_id is None:
        workflow_id = workflow_id_for(issue.project_id, issue.type_id)
    if workflow_id is None:
        return True
    if from_state is not None and to_state is not None and from_state.pk == to_state.pk:
        return True
    if to_state is None or to_state.workflow_status_id is None or to_state.project_id != issue.project_id:
        return False
    # Triage and unmanaged states have no arrow of their own, only global ones (P5).
    sources = Q(from_any=True)
    if from_state is not None and from_state.workflow_status_id is not None:
        sources |= Q(sources__source__status_id=from_state.workflow_status_id)
    transitions = (
        WorkflowTransition.objects.filter(
            sources, workflow_id=workflow_id, target__status_id=to_state.workflow_status_id
        )
        .distinct()
        .prefetch_related("rules")
    )
    return any(all(_rule_allows(rule, issue, actor) for rule in transition.rules.all()) for transition in transitions)


def resolve_workflow_state(*, project_id, instance, state, state_given, type_id):
    """State a written work item must take (T1, T2, 4.1), None to keep the request as is; raises one refusal."""
    if instance is not None and not state_given and type_id is None:
        return None
    if state is not None and state.group == StateGroup.TRIAGE.value:
        # Intake items stay in triage outside any workflow (invariant 6), but a managed item cannot re-enter it.
        if instance is None or instance.state.group == StateGroup.TRIAGE.value:
            return None
        if workflow_id_for(project_id, instance.type_id) is None:
            return None
        raise refusal(TRANSITION_NOT_ALLOWED)
    if instance is None:
        workflow_id = workflow_id_for(project_id, type_id or project_default_type_id(project_id))
        if workflow_id is None:
            return None
        initial = initial_state(project_id, workflow_id)
        if initial is None or (state_given and state is not None and state.pk != initial.pk):
            raise refusal(TRANSITION_NOT_ALLOWED)
        return initial
    new_type_id = type_id if type_id is not None else instance.type_id
    workflow_id = workflow_id_for(project_id, new_type_id)
    if workflow_id is None:
        return None
    if state_given and state is None:
        raise refusal(TRANSITION_NOT_ALLOWED)
    if workflow_id != workflow_id_for(project_id, instance.type_id):
        # A change of workflow, not a move inside one: no arrow needed (T2).
        if state_given:
            if not state_in_workflow(state, workflow_id, project_id):
                raise refusal(TRANSITION_NOT_ALLOWED)
            return None
        if state_in_workflow(instance.state, workflow_id, project_id):
            return None
        raise refusal(ARRIVAL_STATE_REQUIRED)
    if not state_given or state.pk == instance.state_id:
        return None
    if not check_transition(instance, instance.state, state, get_current_user(), workflow_id=workflow_id):
        raise refusal(TRANSITION_NOT_ALLOWED)
    return None


def intake_accept_state(issue):
    """T3: an accepted intake item enters its workflow's initial state, or the project default when free."""
    workflow_id = workflow_id_for(issue.project_id, issue.type_id)
    if workflow_id is not None:
        return initial_state(issue.project_id, workflow_id)
    return State.objects.filter(project_id=issue.project_id, default=True).first()


def workflow_close_state(project_id, workflow_id):
    """T4: a cancelled state reachable by a rule-free global transition; the task has no actor (P9)."""
    status_id = (
        WorkflowTransition.objects.filter(
            workflow_id=workflow_id,
            from_any=True,
            rules__isnull=True,
            target__status__group=StateGroup.CANCELLED.value,
        )
        .order_by("created_at")
        .values_list("target__status_id", flat=True)
        .first()
    )
    if status_id is None:
        return None
    return State.objects.filter(project_id=project_id, workflow_status_id=status_id).first()


MANAGED_STATES_REFUSAL = {"error": "managed_by_workflow"}


def project_has_scheme(project_id):
    return ProjectWorkflowScheme.objects.filter(project_id=project_id).exists()
