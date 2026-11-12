# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Python imports
import copy

# Django imports
from django.db import models, transaction
from django.db.models import Q
from django.db.models.functions import Lower
from django.db.models.signals import post_save
from django.dispatch import receiver

# Module imports
from .project import ProjectBaseModel
from .base import BaseModel

DEFAULT_ISSUE_TYPE_NAME = "Tâche"
DEFAULT_ISSUE_TYPE_LOGO_PROPS = {"in_use": "icon", "icon": {"name": "check_box", "color": "#6d7b8a"}}


class IssueType(BaseModel):
    workspace = models.ForeignKey("db.Workspace", related_name="issue_types", on_delete=models.CASCADE)
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    logo_props = models.JSONField(default=dict)
    is_epic = models.BooleanField(default=False)
    is_default = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    level = models.FloatField(default=0)
    external_source = models.CharField(max_length=255, null=True, blank=True)
    external_id = models.CharField(max_length=255, blank=True, null=True)

    class Meta:
        verbose_name = "Issue Type"
        verbose_name_plural = "Issue Types"
        db_table = "issue_types"
        constraints = [
            models.UniqueConstraint(
                Lower("name"),
                "workspace",
                condition=Q(deleted_at__isnull=True),
                name="issue_type_unique_lower_name_workspace_when_deleted_at_null",
            ),
            models.UniqueConstraint(
                fields=["workspace"],
                condition=Q(is_default=True, deleted_at__isnull=True),
                name="issue_type_unique_default_workspace_when_deleted_at_null",
            ),
        ]

    def __str__(self):
        return self.name


class ProjectIssueType(ProjectBaseModel):
    issue_type = models.ForeignKey("db.IssueType", related_name="project_issue_types", on_delete=models.CASCADE)
    level = models.PositiveIntegerField(default=0)
    is_default = models.BooleanField(default=False)

    class Meta:
        unique_together = ["project", "issue_type", "deleted_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["project", "issue_type"],
                condition=Q(deleted_at__isnull=True),
                name="project_issue_type_unique_project_issue_type_when_deleted_at_null",
            ),
            models.UniqueConstraint(
                fields=["project"],
                condition=Q(is_default=True, deleted_at__isnull=True),
                name="project_issue_type_unique_default_project_when_deleted_at_null",
            ),
        ]
        verbose_name = "Project Issue Type"
        verbose_name_plural = "Project Issue Types"
        db_table = "project_issue_types"
        ordering = ("project", "issue_type")

    def __str__(self):
        return f"{self.project} - {self.issue_type}"


def get_or_create_workspace_default_issue_type(workspace_id):
    """Return the workspace default type, creating it when missing (invariant 1)."""
    issue_type = IssueType.objects.filter(workspace_id=workspace_id, is_default=True).first()
    if issue_type is not None:
        return issue_type
    issue_type = IssueType.objects.filter(workspace_id=workspace_id, name__iexact=DEFAULT_ISSUE_TYPE_NAME).first()
    if issue_type is None:
        return IssueType.objects.create(
            workspace_id=workspace_id,
            name=DEFAULT_ISSUE_TYPE_NAME,
            logo_props=copy.deepcopy(DEFAULT_ISSUE_TYPE_LOGO_PROPS),
            is_default=True,
            is_active=True,
        )
    issue_type.is_default = True
    issue_type.is_active = True
    issue_type.save(update_fields=["is_default", "is_active", "updated_at"])
    return issue_type


def ensure_project_default_issue_type(project):
    """Make the workspace default type the project default when the project has none (invariant 2)."""
    with transaction.atomic():
        if ProjectIssueType.objects.filter(project_id=project.id, is_default=True).exists():
            return
        issue_type = get_or_create_workspace_default_issue_type(project.workspace_id)
        link, created = ProjectIssueType.objects.get_or_create(
            project=project, issue_type=issue_type, defaults={"is_default": True}
        )
        if not created:
            link.is_default = True
            link.save(update_fields=["is_default", "updated_at"])


@receiver(post_save, sender="db.Workspace")
def create_workspace_default_issue_type(sender, instance, created, **kwargs):
    if created:
        get_or_create_workspace_default_issue_type(instance.id)


@receiver(post_save, sender="db.Project")
def create_project_default_issue_type(sender, instance, created, **kwargs):
    if created:
        ensure_project_default_issue_type(instance)
