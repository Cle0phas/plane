# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import pytest
from rest_framework import status

from plane.db.models import Project, ProjectMember, State, WorkflowStatus
from plane.tests.factories import WorkspaceFactory
from plane.tests.workflow_builders import build_workflow, link_project

STATES_URL = "/api/workspaces/{slug}/projects/{project_id}/states/"
STATE_URL = "/api/workspaces/{slug}/projects/{project_id}/states/{pk}/"
DEFAULT_URL = "/api/workspaces/{slug}/projects/{project_id}/states/{pk}/mark-default/"
REFUSED = {"error": "managed_by_workflow"}


@pytest.fixture
def project(db, workspace, create_user):
    project = Project.objects.create(name="Home", identifier="HOME", workspace=workspace, created_by=create_user)
    ProjectMember.objects.create(project=project, member=create_user, role=20)
    return project


@pytest.mark.contract
@pytest.mark.django_db
class TestManagedStates:
    def test_every_state_write_is_refused_under_a_scheme(self, session_client, workspace, project):
        states = link_project(project, build_workflow(workspace, "Flow", ["Open", "Done"], [(["Open"], "Done", None)]))
        args = {"slug": workspace.slug, "project_id": project.id}
        done = states["Done"]
        responses = [
            session_client.post(
                STATES_URL.format(**args), {"name": "Extra", "color": "#000000", "group": "started"}, format="json"
            ),
            session_client.patch(STATE_URL.format(pk=done.id, **args), {"name": "Renamed"}, format="json"),
            session_client.patch(STATE_URL.format(pk=done.id, **args), {"sequence": 1}, format="json"),
            session_client.post(DEFAULT_URL.format(pk=done.id, **args)),
            session_client.delete(STATE_URL.format(pk=done.id, **args)),
        ]
        assert [response.status_code for response in responses] == [status.HTTP_400_BAD_REQUEST] * 5
        assert all(response.data == REFUSED for response in responses)
        done.refresh_from_db()
        assert (done.name, done.default) == ("Done", False)
        assert not State.objects.filter(project=project, name="Extra").exists()

    def test_states_expose_their_status_and_clients_cannot_set_it(self, session_client, workspace, project):
        foreign_status = WorkflowStatus.objects.create(workspace=WorkspaceFactory(), name="Foreign", color="#3A3A3A")
        args = {"slug": workspace.slug, "project_id": project.id}
        created = session_client.post(
            STATES_URL.format(**args),
            {"name": "Mine", "color": "#000000", "group": "started", "workflow_status": str(foreign_status.id)},
            format="json",
        )
        assert created.status_code == status.HTTP_200_OK, created.data
        assert created.data["workflow_status"] is None
        assert State.objects.get(pk=created.data["id"]).workflow_status_id is None
        listed = session_client.get(STATES_URL.format(**args))
        assert all("workflow_status" in state for state in listed.data)

    def test_a_free_project_keeps_editing_its_states(self, session_client, workspace, project):
        state = State.objects.create(name="Open", project=project)
        response = session_client.patch(
            STATE_URL.format(slug=workspace.slug, project_id=project.id, pk=state.id), {"name": "Ready"}, format="json"
        )
        assert response.status_code == status.HTTP_200_OK
