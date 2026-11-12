# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import json
from types import SimpleNamespace

import pytest
from django.utils import timezone

from plane.bgtasks.issue_activities_task import issue_activity
from plane.db.models import Issue, IssueActivity, IssueType, Project, ProjectIssueType
from plane.tests.factories import IssueTypeFactory, WorkspaceFactory

pytestmark = [pytest.mark.unit, pytest.mark.django_db]


@pytest.fixture
def scope(workspace, create_user):
    project = Project.objects.create(name="Home", identifier="HOME", workspace=workspace, created_by=create_user)
    bug = IssueTypeFactory(workspace=workspace, name="Bug")
    ProjectIssueType.objects.create(project=project, issue_type=bug)
    return SimpleNamespace(
        user=create_user,
        project=project,
        issue=Issue.objects.create(name="Item", project=project),
        default_type=IssueType.objects.get(workspace=workspace, is_default=True),
        bug=bug,
    )


def _update(scope, requested, current):
    issue_activity(
        type="issue.activity.updated",
        requested_data=json.dumps(requested),
        current_instance=json.dumps(current),
        issue_id=str(scope.issue.id),
        actor_id=str(scope.user.id),
        project_id=str(scope.project.id),
        epoch=int(timezone.now().timestamp()),
    )


def test_a_type_change_is_recorded(scope, mock_celery):
    _update(scope, {"type_id": str(scope.bug.id)}, {"type_id": str(scope.default_type.id)})

    activity = IssueActivity.objects.get(issue=scope.issue, field="type")
    assert activity.verb == "updated"
    assert activity.old_value == scope.default_type.name
    assert activity.new_value == "Bug"
    assert activity.old_identifier == scope.default_type.id
    assert activity.new_identifier == scope.bug.id
    assert activity.actor_id == scope.user.id


def test_the_api_v1_current_instance_key_is_supported(scope, mock_celery):
    _update(scope, {"type_id": str(scope.bug.id)}, {"type": str(scope.default_type.id)})
    assert IssueActivity.objects.filter(issue=scope.issue, field="type").exists()


def test_an_unchanged_type_records_nothing(scope, mock_celery):
    _update(scope, {"type_id": str(scope.default_type.id)}, {"type_id": str(scope.default_type.id)})
    assert not IssueActivity.objects.filter(issue=scope.issue, field="type").exists()


def test_a_type_of_another_workspace_is_never_named(scope, mock_celery):
    foreign = IssueTypeFactory(workspace=WorkspaceFactory(), name="Foreign secret")
    _update(scope, {"type_id": str(foreign.id)}, {"type_id": str(scope.default_type.id)})
    assert not IssueActivity.objects.filter(issue=scope.issue, field="type").exists()
