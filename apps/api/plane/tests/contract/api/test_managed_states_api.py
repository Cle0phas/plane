# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import pytest
from rest_framework import status

from plane.db.models import Project, ProjectMember, State, WorkflowStatus
from plane.tests.factories import WorkspaceFactory
from plane.tests.workflow_builders import build_workflow, link_project

STATES_URL = "/api/v1/workspaces/{slug}/projects/{project_id}/states/"
STATE_URL = "/api/v1/workspaces/{slug}/projects/{project_id}/states/{pk}/"


@pytest.fixture
def project(db, workspace, create_user):
    project = Project.objects.create(name="Home", identifier="HOME", workspace=workspace, created_by=create_user)
    ProjectMember.objects.create(project=project, member=create_user, role=20, is_active=True)
    return project


@pytest.mark.contract
@pytest.mark.django_db
class TestManagedStatesApiV1:
    def test_writes_are_refused_under_a_scheme(self, api_key_client, workspace, project):
        states = link_project(project, build_workflow(workspace, "Flow", ["Open", "Done"], [(["Open"], "Done", None)]))
        args = {"slug": workspace.slug, "project_id": project.id}
        responses = [
            api_key_client.post(STATES_URL.format(**args), {"name": "Extra", "color": "#000000"}, format="json"),
            api_key_client.patch(STATE_URL.format(pk=states["Done"].id, **args), {"default": True}, format="json"),
            api_key_client.delete(STATE_URL.format(pk=states["Done"].id, **args)),
        ]
        assert [response.status_code for response in responses] == [status.HTTP_400_BAD_REQUEST] * 3
        assert all(response.data == {"error": "managed_by_workflow"} for response in responses)

    def test_workflow_status_is_read_only(self, api_key_client, workspace, project):
        foreign_status = WorkflowStatus.objects.create(workspace=WorkspaceFactory(), name="Foreign", color="#3A3A3A")
        response = api_key_client.post(
            STATES_URL.format(slug=workspace.slug, project_id=project.id),
            {"name": "Mine", "color": "#000000", "workflow_status": str(foreign_status.id)},
            format="json",
        )
        assert response.status_code == status.HTTP_200_OK, response.data
        assert State.objects.get(pk=response.data["id"]).workflow_status_id is None
