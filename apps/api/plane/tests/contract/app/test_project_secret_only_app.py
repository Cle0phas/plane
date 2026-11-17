# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import pytest
from django.db import IntegrityError, transaction
from rest_framework import status
from rest_framework.test import APIClient

from plane.db.models import Project, ProjectMember, WorkspaceMember
from plane.tests.factories import UserFactory

PROJECTS_URL = "/api/workspaces/{slug}/projects/"
PROJECT_URL = "/api/workspaces/{slug}/projects/{pk}/"
JOIN_URL = "/api/users/me/workspaces/{slug}/projects/invitations/"


def _client(workspace, role):
    user = UserFactory()
    WorkspaceMember.objects.create(workspace=workspace, member=user, role=role)
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def project(workspace, create_user):
    project = Project.objects.create(name="Team", identifier="TEAM", workspace=workspace, created_by=create_user)
    ProjectMember.objects.create(project=project, member=create_user, role=20)
    return project


@pytest.mark.contract
@pytest.mark.django_db
class TestProjectsAreSecret:
    """A project belongs to one team: only its members see it, there is no public project."""

    def test_a_project_is_created_secret(self, session_client, workspace):
        response = session_client.post(
            PROJECTS_URL.format(slug=workspace.slug), {"name": "Team", "identifier": "TEAM"}, format="json"
        )
        assert response.status_code == status.HTTP_201_CREATED, response.data
        assert response.data["network"] == 0
        assert Project.objects.get(identifier="TEAM").network == 0

    def test_public_is_refused_on_create(self, session_client, workspace):
        response = session_client.post(
            PROJECTS_URL.format(slug=workspace.slug),
            {"name": "Open", "identifier": "OPEN", "network": 2},
            format="json",
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "network" in response.data
        assert not Project.objects.filter(identifier="OPEN").exists()

    def test_public_is_refused_on_update(self, session_client, workspace, project):
        response = session_client.patch(
            PROJECT_URL.format(slug=workspace.slug, pk=project.id), {"network": 2}, format="json"
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "network" in response.data
        project.refresh_from_db()
        assert project.network == 0

    def test_the_database_refuses_a_public_project(self, workspace):
        with pytest.raises(IntegrityError), transaction.atomic():
            Project.objects.create(name="Open", identifier="OPEN", workspace=workspace, network=2)

    @pytest.mark.parametrize("role", [15, 5])
    def test_a_workspace_member_outside_the_project_neither_sees_nor_joins_it(self, workspace, project, role):
        client = _client(workspace, role)
        listed = client.get(PROJECTS_URL.format(slug=workspace.slug))
        assert listed.status_code == status.HTTP_200_OK
        assert str(project.id) not in str(listed.data)
        detail = client.get(PROJECT_URL.format(slug=workspace.slug, pk=project.id))
        assert detail.status_code == status.HTTP_403_FORBIDDEN
        joined = client.post(JOIN_URL.format(slug=workspace.slug), {"project_ids": [str(project.id)]}, format="json")
        assert joined.status_code == status.HTTP_403_FORBIDDEN
        assert ProjectMember.objects.filter(project=project).count() == 1

    def test_a_workspace_admin_outside_the_project_sees_it_and_may_join(self, workspace, project):
        client = _client(workspace, 20)
        listed = client.get(PROJECTS_URL.format(slug=workspace.slug))
        assert str(project.id) in str(listed.data)
        joined = client.post(JOIN_URL.format(slug=workspace.slug), {"project_ids": [str(project.id)]}, format="json")
        assert joined.status_code == status.HTTP_201_CREATED
        assert ProjectMember.objects.filter(project=project, is_active=True).count() == 2
