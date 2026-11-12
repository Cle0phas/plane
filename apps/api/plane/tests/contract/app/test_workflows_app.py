# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from uuid import uuid4

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from plane.db.models import (
    AuditLog,
    Issue,
    Project,
    ProjectMember,
    Workflow,
    WorkflowState,
    WorkflowStatus,
    WorkspaceMember,
)
from plane.tests.factories import UserFactory, WorkspaceFactory
from plane.tests.workflow_builders import build_workflow, link_project

STATUSES_URL = "/api/workspaces/{slug}/workflow-statuses/"
STATUS_URL = "/api/workspaces/{slug}/workflow-statuses/{pk}/"
WORKFLOWS_URL = "/api/workspaces/{slug}/workflows/"
WORKFLOW_URL = "/api/workspaces/{slug}/workflows/{pk}/"
GRAPH_URL = "/api/workspaces/{slug}/workflows/{pk}/graph/"


def _client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def users(db, workspace, create_user):
    people = {"admin": create_user}
    for name, role in (("member", 15), ("guest", 5)):
        people[name] = UserFactory()
        WorkspaceMember.objects.create(workspace=workspace, member=people[name], role=role)
    return people


@pytest.fixture
def project(workspace, users):
    project = Project.objects.create(name="Secret", identifier="SEC", workspace=workspace, created_by=users["admin"])
    ProjectMember.objects.create(project=project, member=users["admin"], role=20)
    return project


@pytest.fixture
def software(workspace):
    return build_workflow(workspace, "Software", ["To do", "Done"], [(["To do"], "Done", None)])


def _graph_payload(workflow, extra_states=(), drop=()):
    states = [
        {
            "key": str(state.id),
            "status": {"id": str(state.status_id), "name": state.status.name, "color": state.status.color},
            "position_x": 0,
            "position_y": 0,
            "is_initial": state.is_initial,
        }
        for name, state in workflow.states_by_name.items()
        if name not in drop
    ]
    return {"states": states + list(extra_states), "transitions": []}


@pytest.mark.contract
@pytest.mark.django_db
class TestRead:
    @pytest.mark.parametrize("role", ["admin", "member", "guest"])
    def test_every_member_reads_workflows_and_statuses(self, workspace, users, software, role):
        client = _client(users[role])
        listed = client.get(WORKFLOWS_URL.format(slug=workspace.slug))
        detail = client.get(WORKFLOW_URL.format(slug=workspace.slug, pk=software.id))
        statuses = client.get(STATUSES_URL.format(slug=workspace.slug))
        assert listed.status_code == detail.status_code == statuses.status_code == status.HTTP_200_OK
        assert listed.data[0]["state_count"] == 2
        assert [state["status"]["name"] for state in detail.data["states"]] == ["To do", "Done"]
        assert {item["name"] for item in statuses.data} == {"To do", "Done"}

    def test_project_names_only_reach_workspace_admins(self, workspace, users, project, software):
        link_project(project, software)
        as_admin = _client(users["admin"]).get(WORKFLOWS_URL.format(slug=workspace.slug)).data[0]
        as_member = _client(users["member"]).get(WORKFLOWS_URL.format(slug=workspace.slug)).data[0]
        assert as_admin["projects"] == [{"id": str(project.id), "name": "Secret"}]
        assert as_member["project_count"] == 1
        assert "projects" not in as_member

    def test_non_member_is_refused(self, workspace, software):
        assert _client(UserFactory()).get(WORKFLOWS_URL.format(slug=workspace.slug)).status_code == (
            status.HTTP_403_FORBIDDEN
        )

    def test_a_workflow_of_another_workspace_looks_missing(self, workspace, users):
        foreign = build_workflow(WorkspaceFactory(), "Foreign", ["A"])
        client = _client(users["admin"])
        hidden = client.get(WORKFLOW_URL.format(slug=workspace.slug, pk=foreign.id))
        missing = client.get(WORKFLOW_URL.format(slug=workspace.slug, pk=uuid4()))
        assert hidden.status_code == missing.status_code == status.HTTP_404_NOT_FOUND
        assert hidden.data == missing.data


@pytest.mark.contract
@pytest.mark.django_db
class TestWrite:
    @pytest.mark.parametrize("role", ["member", "guest"])
    def test_non_admins_cannot_write(self, workspace, users, software, role):
        client = _client(users[role])
        responses = [
            client.post(WORKFLOWS_URL.format(slug=workspace.slug), {"name": "New"}, format="json"),
            client.patch(WORKFLOW_URL.format(slug=workspace.slug, pk=software.id), {"name": "X"}, format="json"),
            client.delete(WORKFLOW_URL.format(slug=workspace.slug, pk=software.id)),
            client.put(GRAPH_URL.format(slug=workspace.slug, pk=software.id), _graph_payload(software), format="json"),
            client.delete(STATUS_URL.format(slug=workspace.slug, pk=software.states_by_name["Done"].status_id)),
        ]
        assert {response.status_code for response in responses} == {status.HTTP_403_FORBIDDEN}
        assert not AuditLog.objects.exists()

    def test_create_rename_and_audit(self, workspace, users):
        client = _client(users["admin"])
        created = client.post(WORKFLOWS_URL.format(slug=workspace.slug), {"name": "Support"}, format="json")
        assert created.status_code == status.HTTP_201_CREATED, created.data
        duplicate = client.post(WORKFLOWS_URL.format(slug=workspace.slug), {"name": "SUPPORT"}, format="json")
        assert duplicate.status_code == status.HTTP_400_BAD_REQUEST
        assert "name" in duplicate.data
        renamed = client.patch(
            WORKFLOW_URL.format(slug=workspace.slug, pk=created.data["id"]), {"name": "Help"}, format="json"
        )
        assert renamed.status_code == status.HTTP_200_OK
        assert list(AuditLog.objects.order_by("created_at").values_list("action", flat=True)) == [
            "workflow.created",
            "workflow.updated",
        ]

    def test_a_linked_workflow_cannot_be_deleted(self, workspace, users, project, software):
        link_project(project, software)
        response = _client(users["admin"]).delete(WORKFLOW_URL.format(slug=workspace.slug, pk=software.id))
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert response.data["error"] == "workflow_in_use"

    def test_deleting_a_workflow_frees_its_statuses(self, workspace, users, software):
        client = _client(users["admin"])
        assert client.delete(WORKFLOW_URL.format(slug=workspace.slug, pk=software.id)).status_code == (
            status.HTTP_204_NO_CONTENT
        )
        assert not Workflow.objects.filter(pk=software.id).exists()
        assert not WorkflowState.objects.filter(workflow_id=software.id).exists()
        done_id = software.states_by_name["Done"].status_id
        assert (
            client.delete(STATUS_URL.format(slug=workspace.slug, pk=done_id)).status_code == status.HTTP_204_NO_CONTENT
        )
        assert not WorkflowStatus.objects.filter(pk=done_id).exists()
        assert AuditLog.objects.filter(action="workflow_status.deleted", target_id=done_id).exists()

    def test_a_status_used_by_a_workflow_cannot_be_deleted(self, workspace, users, software):
        response = _client(users["admin"]).delete(
            STATUS_URL.format(slug=workspace.slug, pk=software.states_by_name["Done"].status_id)
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert response.data == {"error": "status_in_use"}


@pytest.mark.contract
@pytest.mark.django_db
class TestGraph:
    def test_admin_saves_a_graph(self, workspace, users, software):
        new_state = {
            "key": "n1",
            "status": {"name": "Review", "color": "#00AA00"},
            "position_x": 10,
            "position_y": 20,
            "is_initial": False,
        }
        response = _client(users["admin"]).put(
            GRAPH_URL.format(slug=workspace.slug, pk=software.id), _graph_payload(software, [new_state]), format="json"
        )
        assert response.status_code == status.HTTP_200_OK, response.data
        assert [state["status"]["name"] for state in response.data["states"]] == ["To do", "Done", "Review"]
        assert AuditLog.objects.filter(action="workflow.graph_updated").count() == 1

    def test_removing_a_used_status_is_refused_with_project_counts(self, workspace, users, project, software):
        states = link_project(project, software)
        Issue.objects.create(name="Item", project=project, state=states["Done"])
        response = _client(users["admin"]).put(
            GRAPH_URL.format(slug=workspace.slug, pk=software.id),
            _graph_payload(software, drop=["Done"]),
            format="json",
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert response.data["graph"] == ["status_in_use"]
        assert response.data["projects"] == [
            {"project_id": str(project.id), "project_name": "Secret", "issue_count": 1}
        ]

    def test_a_new_status_named_like_an_existing_one_is_refused(self, workspace, users, software):
        WorkflowStatus.objects.create(workspace=workspace, name="Shelved", color="#3A3A3A")
        clash = {
            "key": "n1",
            "status": {"name": "shelved", "color": "#3A3A3A"},
            "position_x": 0,
            "position_y": 0,
            "is_initial": False,
        }
        response = _client(users["admin"]).put(
            GRAPH_URL.format(slug=workspace.slug, pk=software.id), _graph_payload(software, [clash]), format="json"
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert response.data == {"graph": ["duplicate_status_name"]}

    def test_a_graph_of_another_workspace_looks_missing(self, workspace, users, software):
        foreign = build_workflow(WorkspaceFactory(), "Foreign", ["A"])
        response = _client(users["admin"]).put(
            GRAPH_URL.format(slug=workspace.slug, pk=foreign.id), _graph_payload(software), format="json"
        )
        assert response.status_code == status.HTTP_404_NOT_FOUND

    def test_a_non_object_body_is_refused(self, workspace, users, software):
        response = _client(users["admin"]).put(GRAPH_URL.format(slug=workspace.slug, pk=software.id), [], format="json")
        assert response.status_code == status.HTTP_400_BAD_REQUEST
