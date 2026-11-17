# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import pytest

from plane.db.models import Issue, IssueType, Project, ProjectIssueType, Workspace
from plane.db.models.issue_type import (
    DEFAULT_ISSUE_TYPE_LOGO_PROPS,
    DEFAULT_ISSUE_TYPE_NAME,
    get_or_create_workspace_default_issue_type,
)
from plane.tests.factories import IssueTypeFactory

pytestmark = [pytest.mark.unit, pytest.mark.django_db]


def _project_default_type_id(project):
    return ProjectIssueType.objects.get(project=project, is_default=True).issue_type_id


@pytest.fixture
def project(workspace, create_user):
    return Project.objects.create(name="Home", identifier="HOME", workspace=workspace, created_by=create_user)


def test_workspace_creation_creates_the_default_type(create_user):
    workspace = Workspace.objects.create(name="Fresh", slug="fresh-workspace", owner=create_user)
    default = IssueType.objects.get(workspace=workspace, is_default=True)
    assert default.name == DEFAULT_ISSUE_TYPE_NAME
    assert default.is_active
    assert default.logo_props == DEFAULT_ISSUE_TYPE_LOGO_PROPS
    assert IssueType.objects.filter(workspace=workspace).count() == 1


def test_project_creation_uses_the_workspace_default_as_project_default(workspace, project):
    link = ProjectIssueType.objects.get(project=project, is_default=True)
    assert link.issue_type == IssueType.objects.get(workspace=workspace, is_default=True)
    assert ProjectIssueType.objects.filter(project=project).count() == 1


def test_workspace_default_lookup_is_idempotent(workspace):
    first = get_or_create_workspace_default_issue_type(workspace.id)
    second = get_or_create_workspace_default_issue_type(workspace.id)
    assert first.pk == second.pk
    assert IssueType.objects.filter(workspace=workspace).count() == 1


def test_workspace_default_lookup_promotes_an_existing_tache(workspace):
    IssueType.all_objects.filter(workspace=workspace).delete()
    existing = IssueType.objects.create(workspace=workspace, name="tâche", is_default=False, is_active=False)
    result = get_or_create_workspace_default_issue_type(workspace.id)
    existing.refresh_from_db()
    assert result.pk == existing.pk
    assert existing.is_default and existing.is_active


def test_work_item_without_type_gets_the_project_default(project):
    issue = Issue.objects.create(name="No type", project=project)
    assert issue.type_id == _project_default_type_id(project)


def test_work_item_keeps_a_type_enabled_in_its_project(workspace, project):
    bug = IssueTypeFactory(workspace=workspace, name="Bug")
    ProjectIssueType.objects.create(project=project, issue_type=bug)
    issue = Issue.objects.create(name="Bug item", project=project, type=bug)
    assert issue.type_id == bug.id


def test_work_item_with_a_type_not_enabled_gets_the_project_default(workspace, project):
    bug = IssueTypeFactory(workspace=workspace, name="Bug")
    issue = Issue.objects.create(name="Bug item", project=project, type=bug)
    assert issue.type_id == _project_default_type_id(project)


def test_moving_a_work_item_to_a_project_without_its_type_uses_the_target_default(workspace, project, create_user):
    target = Project.objects.create(name="Target", identifier="TGT", workspace=workspace, created_by=create_user)
    bug = IssueTypeFactory(workspace=workspace, name="Bug")
    ProjectIssueType.objects.create(project=project, issue_type=bug)
    issue = Issue.objects.get(pk=Issue.objects.create(name="Mover", project=project, type=bug).pk)

    issue.project = target
    issue.save()

    issue.refresh_from_db()
    assert issue.type_id == _project_default_type_id(target)


def test_moving_a_work_item_keeps_a_type_enabled_in_the_target(workspace, project, create_user):
    target = Project.objects.create(name="Target", identifier="TGT", workspace=workspace, created_by=create_user)
    bug = IssueTypeFactory(workspace=workspace, name="Bug")
    ProjectIssueType.objects.create(project=project, issue_type=bug)
    ProjectIssueType.objects.create(project=target, issue_type=bug)
    issue = Issue.objects.get(pk=Issue.objects.create(name="Mover", project=project, type=bug).pk)

    issue.project = target
    issue.save()

    issue.refresh_from_db()
    assert issue.type_id == bug.id


def test_partial_save_backfills_a_missing_type(project):
    issue = Issue.objects.create(name="Legacy", project=project)
    Issue.objects.filter(pk=issue.pk).update(type=None)
    issue = Issue.objects.get(pk=issue.pk)

    issue.save(update_fields=["updated_at"])

    issue.refresh_from_db()
    assert issue.type_id == _project_default_type_id(project)
