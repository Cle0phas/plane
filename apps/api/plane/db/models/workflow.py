# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Python imports
import uuid

# Django imports
from django.db import models
from django.db.models import Q
from django.db.models.functions import Lower

# Module imports
from .base import BaseModel
from .state import StateGroup

MAX_STATUSES_PER_WORKSPACE = 1000
MAX_STATES_PER_WORKFLOW = 200
MAX_TRANSITIONS_PER_WORKFLOW = 1000
RULE_RESTRICT_ACTORS = "restrict_actors"
WORKFLOW_GROUPS = [group for group in StateGroup.values if group != StateGroup.TRIAGE.value]
# The intake creates a project state named "Triage" in every project (P7).
RESERVED_STATUS_NAMES = {"triage"}
TRANSITION_SIDES = ["top", "right", "bottom", "left"]


class WorkflowGraphRow(models.Model):
    """Inner row of a workflow graph: hard-deleted with its parent, history kept in the audit snapshot (P2)."""

    id = models.UUIDField(default=uuid.uuid4, unique=True, editable=False, db_index=True, primary_key=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class WorkflowStatus(BaseModel):
    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="workflow_statuses")
    name = models.CharField(max_length=255)
    color = models.CharField(max_length=7)
    group = models.CharField(max_length=20, choices=StateGroup.choices, default=StateGroup.STARTED)
    group_is_auto = models.BooleanField(default=True)
    sequence = models.FloatField(default=65535)

    class Meta:
        db_table = "workflow_statuses"
        ordering = ("sequence", "name")
        constraints = [
            models.UniqueConstraint(
                Lower("name"),
                "workspace",
                condition=Q(deleted_at__isnull=True),
                name="workflow_status_unique_lower_name_ws_when_deleted_at_null",
            ),
            models.CheckConstraint(
                condition=~Q(group=StateGroup.TRIAGE.value), name="workflow_status_group_not_triage"
            ),
        ]

    def __str__(self):
        return self.name


class Workflow(BaseModel):
    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="workflows")
    name = models.CharField(max_length=255)
    description = models.CharField(max_length=1000, blank=True, default="")

    class Meta:
        db_table = "workflows"
        ordering = ("name",)
        constraints = [
            models.UniqueConstraint(
                Lower("name"),
                "workspace",
                condition=Q(deleted_at__isnull=True),
                name="workflow_unique_lower_name_workspace_when_deleted_at_null",
            ),
        ]

    def __str__(self):
        return self.name


class WorkflowState(WorkflowGraphRow):
    workflow = models.ForeignKey(Workflow, on_delete=models.CASCADE, related_name="states")
    status = models.ForeignKey(WorkflowStatus, on_delete=models.PROTECT, related_name="workflow_states")
    position_x = models.FloatField(default=0)
    position_y = models.FloatField(default=0)
    is_initial = models.BooleanField(default=False)

    class Meta:
        db_table = "workflow_states"
        constraints = [
            models.UniqueConstraint(fields=["workflow", "status"], name="workflow_state_unique_status"),
            models.UniqueConstraint(
                fields=["workflow"], condition=Q(is_initial=True), name="workflow_state_single_initial"
            ),
        ]


class WorkflowTransition(WorkflowGraphRow):
    workflow = models.ForeignKey(Workflow, on_delete=models.CASCADE, related_name="transitions")
    target = models.ForeignKey(WorkflowState, on_delete=models.CASCADE, related_name="incoming_transitions")
    name = models.CharField(max_length=255, blank=True, default="")
    from_any = models.BooleanField(default=False)

    class Meta:
        db_table = "workflow_transitions"


class WorkflowTransitionSource(WorkflowGraphRow):
    transition = models.ForeignKey(WorkflowTransition, on_delete=models.CASCADE, related_name="sources")
    source = models.ForeignKey(WorkflowState, on_delete=models.CASCADE, related_name="outgoing_sources")
    # Empty: the editor picks the closest pair of sides (X4).
    source_side = models.CharField(
        max_length=6, blank=True, default="", choices=[(side, side) for side in TRANSITION_SIDES]
    )
    target_side = models.CharField(
        max_length=6, blank=True, default="", choices=[(side, side) for side in TRANSITION_SIDES]
    )

    class Meta:
        db_table = "workflow_transition_sources"
        constraints = [
            models.UniqueConstraint(fields=["transition", "source"], name="workflow_transition_source_unique"),
            # The copy of a workflow writes rows without the serializer: the database keeps the rule too.
            models.CheckConstraint(
                condition=Q(source_side__in=["", *TRANSITION_SIDES]) & Q(target_side__in=["", *TRANSITION_SIDES]),
                name="workflow_transition_source_sides_valid",
            ),
        ]


class WorkflowTransitionRule(WorkflowGraphRow):
    transition = models.ForeignKey(WorkflowTransition, on_delete=models.CASCADE, related_name="rules")
    rule_type = models.CharField(max_length=64, choices=[(RULE_RESTRICT_ACTORS, "Restrict actors")])
    params = models.JSONField(default=dict)

    class Meta:
        db_table = "workflow_transition_rules"
        constraints = [
            models.UniqueConstraint(fields=["transition", "rule_type"], name="workflow_transition_rule_unique_type"),
        ]


class ProjectWorkflowScheme(WorkflowGraphRow):
    project = models.OneToOneField("db.Project", on_delete=models.CASCADE, related_name="workflow_scheme")
    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="workflow_schemes")
    default_workflow = models.ForeignKey(Workflow, on_delete=models.PROTECT, related_name="default_for_schemes")

    class Meta:
        db_table = "project_workflow_schemes"


class ProjectWorkflowSchemeItem(WorkflowGraphRow):
    scheme = models.ForeignKey(ProjectWorkflowScheme, on_delete=models.CASCADE, related_name="items")
    issue_type = models.ForeignKey("db.IssueType", on_delete=models.CASCADE, related_name="workflow_scheme_items")
    workflow = models.ForeignKey(Workflow, on_delete=models.PROTECT, related_name="scheme_items")

    class Meta:
        db_table = "project_workflow_scheme_items"
        constraints = [
            models.UniqueConstraint(fields=["scheme", "issue_type"], name="project_workflow_scheme_item_unique_type"),
        ]
