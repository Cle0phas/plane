# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from plane.db.models import IssueView, Project, ProjectMember, WorkspaceMember
from plane.tests.factories import IssueTypeFactory, UserFactory


@pytest.fixture
def member(db, workspace):
    user = UserFactory()
    WorkspaceMember.objects.create(workspace=workspace, member=user, role=15)
    return user


@pytest.fixture
def project(workspace, member):
    project = Project.objects.create(name="Home", identifier="HOME", workspace=workspace, created_by=member)
    ProjectMember.objects.create(project=project, member=member, role=15)
    return project


@pytest.mark.contract
@pytest.mark.django_db
class TestSavedViewTypeFilter:
    def _post(self, member, url, type_id):
        client = APIClient()
        client.force_authenticate(user=member)
        return client.post(url, {"name": "By type", "filters": {"issue_type": str(type_id)}}, format="json")

    def test_project_view_filtered_by_type_is_created(self, workspace, project, member):
        bug = IssueTypeFactory(workspace=workspace, name="Bug")
        response = self._post(member, f"/api/workspaces/{workspace.slug}/projects/{project.id}/views/", bug.id)
        assert response.status_code == status.HTTP_201_CREATED, response.content
        assert IssueView.objects.get(pk=response.data["id"]).query == {"type__in": [str(bug.id)]}

    def test_workspace_view_filtered_by_type_is_created(self, workspace, member):
        bug = IssueTypeFactory(workspace=workspace, name="Bug")
        response = self._post(member, f"/api/workspaces/{workspace.slug}/views/", bug.id)
        assert response.status_code == status.HTTP_201_CREATED, response.content
