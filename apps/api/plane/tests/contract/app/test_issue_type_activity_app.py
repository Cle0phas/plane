# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import json
from unittest import mock

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from plane.db.models import Issue, IssueType, Project, ProjectIssueType, ProjectMember
from plane.tests.factories import IssueTypeFactory


@pytest.mark.contract
@pytest.mark.django_db
def test_the_update_view_hands_the_type_change_to_the_activity_task(workspace, create_user):
    project = Project.objects.create(name="Home", identifier="HOME", workspace=workspace, created_by=create_user)
    ProjectMember.objects.create(project=project, member=create_user, role=20)
    bug = IssueTypeFactory(workspace=workspace, name="Bug")
    ProjectIssueType.objects.create(project=project, issue_type=bug)
    issue = Issue.objects.create(name="Item", project=project)
    default_type = IssueType.objects.get(workspace=workspace, is_default=True)
    client = APIClient()
    client.force_authenticate(user=create_user)

    with (
        mock.patch("plane.app.views.issue.base.issue_activity") as issue_activity,
        mock.patch("plane.app.views.issue.base.model_activity"),
        mock.patch("plane.app.views.issue.base.issue_description_version_task"),
    ):
        response = client.patch(
            f"/api/workspaces/{workspace.slug}/projects/{project.id}/issues/{issue.id}/",
            {"type_id": str(bug.id)},
            format="json",
        )

    assert response.status_code == status.HTTP_204_NO_CONTENT, response.data
    kwargs = issue_activity.delay.call_args.kwargs
    assert json.loads(kwargs["requested_data"])["type_id"] == str(bug.id)
    assert json.loads(kwargs["current_instance"])["type_id"] == str(default_type.id)
