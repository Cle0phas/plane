# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from uuid import uuid4

import pytest
from django.core.cache import cache
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from plane.db.models import (
    AuditLog,
    Issue,
    Project,
    ProjectMember,
    ProjectWorkflowScheme,
    State,
    Workflow,
    WorkflowState,
    WorkflowStatus,
    WorkspaceMember,
)
from plane.tests.factories import UserFactory, WorkspaceFactory
from plane.tests.workflow_builders import build_workflow, link_project
from plane.utils.workflow_graph import graph_version, workflow_graph

STATUSES_URL = "/api/workspaces/{slug}/workflow-statuses/"
STATUS_URL = "/api/workspaces/{slug}/workflow-statuses/{pk}/"
WORKFLOWS_URL = "/api/workspaces/{slug}/workflows/"
WORKFLOW_URL = "/api/workspaces/{slug}/workflows/{pk}/"
GRAPH_URL = "/api/workspaces/{slug}/workflows/{pk}/graph/"
CANDIDATES_URL = "/api/workspaces/{slug}/workflow-statuses/candidates/"
DUPLICATE_URL = "/api/workspaces/{slug}/workflows/{pk}/duplicate/"
PRESENCE_URL = "/api/workspaces/{slug}/workflows/{pk}/presence/"


def _client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _version(workflow):
    return graph_version(workflow_graph(workflow))


def _new_state(name):
    return {
        "key": f"new-{name}",
        "status": {"name": name, "color": "#00AA00"},
        "position_x": 10,
        "position_y": 20,
        "is_initial": False,
    }


def _refused_actors(workspace, users, project):
    """Everyone spec 9 plays against an admin-only route: none of them is an admin of this workspace."""
    project_admin = UserFactory()
    WorkspaceMember.objects.create(workspace=workspace, member=project_admin, role=15)
    ProjectMember.objects.create(project=project, member=project_admin, role=20)
    foreign_admin = UserFactory()
    WorkspaceMember.objects.create(workspace=WorkspaceFactory(), member=foreign_admin, role=20)
    return {
        "project_admin": project_admin,
        "member": users["member"],
        "guest": users["guest"],
        "stranger": UserFactory(),
        "foreign_admin": foreign_admin,
    }


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
    return {"states": states + list(extra_states), "transitions": [], "expected_version": _version(workflow)}


@pytest.mark.contract
@pytest.mark.django_db
class TestRead:
    @pytest.mark.parametrize("role", ["admin", "member"])
    def test_admins_and_members_read_workflows_and_statuses(self, workspace, users, software, role):
        client = _client(users[role])
        listed = client.get(WORKFLOWS_URL.format(slug=workspace.slug))
        detail = client.get(WORKFLOW_URL.format(slug=workspace.slug, pk=software.id))
        statuses = client.get(STATUSES_URL.format(slug=workspace.slug))
        assert listed.status_code == detail.status_code == statuses.status_code == status.HTTP_200_OK
        assert listed.data[0]["state_count"] == 2
        assert [state["status"]["name"] for state in detail.data["states"]] == ["To do", "Done"]
        assert {item["name"] for item in statuses.data} == {"To do", "Done"}

    def test_guests_read_neither_workflows_nor_statuses(self, workspace, users, software):
        client = _client(users["guest"])
        for url in (
            WORKFLOWS_URL.format(slug=workspace.slug),
            WORKFLOW_URL.format(slug=workspace.slug, pk=software.id),
            STATUSES_URL.format(slug=workspace.slug),
        ):
            assert client.get(url).status_code == status.HTTP_403_FORBIDDEN

    def test_a_status_names_the_workflows_that_use_it(self, workspace, users, software):
        build_workflow(workspace, "Bug", ["To do", "Fixed"])
        WorkflowStatus.objects.create(workspace=workspace, name="Unused", color="#3A3A3A")
        response = _client(users["member"]).get(STATUSES_URL.format(slug=workspace.slug))
        by_name = {item["name"]: item for item in response.data}
        assert [item["name"] for item in by_name["To do"]["workflows"]] == ["Bug", "Software"]
        assert by_name["Done"]["workflows"] == [{"id": str(software.id), "name": "Software"}]
        assert by_name["Unused"]["workflows"] == []
        assert by_name["To do"]["workflow_count"] == 2

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


@pytest.mark.contract
@pytest.mark.django_db
class TestIsolationAndVisibility:
    def test_write_routes_of_another_workspace_look_missing(self, workspace, users):
        foreign = build_workflow(WorkspaceFactory(), "Foreign", ["A"])
        client = _client(users["admin"])
        foreign_status = foreign.states_by_name["A"].status_id
        responses = [
            client.patch(WORKFLOW_URL.format(slug=workspace.slug, pk=foreign.id), {"name": "X"}, format="json"),
            client.delete(WORKFLOW_URL.format(slug=workspace.slug, pk=foreign.id)),
            client.delete(STATUS_URL.format(slug=workspace.slug, pk=foreign_status)),
        ]
        assert {response.status_code for response in responses} == {status.HTTP_404_NOT_FOUND}
        assert Workflow.objects.filter(pk=foreign.id).exists()
        assert WorkflowStatus.objects.filter(pk=foreign_status).exists()

    def test_detail_hides_project_names_from_members(self, workspace, users, project, software):
        link_project(project, software)
        url = WORKFLOW_URL.format(slug=workspace.slug, pk=software.id)
        assert "projects" not in _client(users["member"]).get(url).data
        assert _client(users["admin"]).get(url).data["projects"] == [{"id": str(project.id), "name": "Secret"}]


@pytest.mark.contract
@pytest.mark.django_db
class TestTransitionSides:
    def _payload(self, software, build):
        payload = _graph_payload(software)
        todo, done = (str(software.states_by_name[name].id) for name in ("To do", "Done"))
        payload["transitions"] = [
            {
                "name": "",
                "from_any": False,
                "source_keys": [todo],
                "target_key": done,
                "rules": [],
                "sides": build(todo),
            }
        ]
        return payload

    def test_sides_survive_a_save_and_a_reload(self, workspace, users, software):
        client = _client(users["admin"])
        todo = str(software.states_by_name["To do"].id)
        payload = self._payload(software, lambda key: {key: {"source": "right", "target": "left"}})
        saved = client.put(GRAPH_URL.format(slug=workspace.slug, pk=software.id), payload, format="json")
        assert saved.status_code == status.HTTP_200_OK
        assert saved.data["transitions"][0]["sides"] == {todo: {"source": "right", "target": "left"}}
        reloaded = client.get(WORKFLOW_URL.format(slug=workspace.slug, pk=software.id))
        assert reloaded.data["transitions"][0]["sides"] == {todo: {"source": "right", "target": "left"}}

    def test_a_transition_without_sides_reports_an_empty_mapping(self, workspace, users, software):
        payload = self._payload(software, lambda key: {})
        del payload["transitions"][0]["sides"]
        saved = _client(users["admin"]).put(
            GRAPH_URL.format(slug=workspace.slug, pk=software.id), payload, format="json"
        )
        assert saved.status_code == status.HTTP_200_OK
        assert saved.data["transitions"][0]["sides"] == {}

    @pytest.mark.parametrize(
        "build",
        [
            lambda key: {"other": {"source": "top", "target": "left"}},
            lambda key: {key: {"source": "middle", "target": "left"}},
            lambda key: {key: {"source": "top"}},
            lambda key: {key: {"source": "top", "target": "left", "extra": 1}},
            lambda key: {key: "top"},
        ],
        ids=["foreign-key", "unknown-side", "missing-target", "extra-key", "not-an-object"],
    )
    def test_bad_sides_are_refused(self, workspace, users, software, build):
        response = _client(users["admin"]).put(
            GRAPH_URL.format(slug=workspace.slug, pk=software.id), self._payload(software, build), format="json"
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert response.data == {"graph": ["invalid_transition"]}


def _state(project, name, group, default=False):
    return State.objects.create(
        project=project, workspace=project.workspace, name=name, group=group, color="#3A3A3A", default=default
    )


@pytest.mark.contract
@pytest.mark.django_db
class TestStatusCandidates:
    def test_admin_reads_project_states_that_are_not_statuses(self, workspace, users, project, software):
        _state(project, "To do", "unstarted")
        _state(project, "In review", "started")
        response = _client(users["admin"]).get(CANDIDATES_URL.format(slug=workspace.slug))
        assert response.status_code == status.HTTP_200_OK
        assert response.data == [{"name": "In review", "color": "#3A3A3A", "group": "started"}]

    @pytest.mark.parametrize("role", ["member", "guest"])
    def test_other_roles_are_refused(self, workspace, users, project, role):
        _state(project, "In review", "started")
        response = _client(users[role]).get(CANDIDATES_URL.format(slug=workspace.slug))
        assert response.status_code == status.HTTP_403_FORBIDDEN

    def test_a_project_admin_who_is_only_a_workspace_member_is_refused(self, workspace, users, project):
        ProjectMember.objects.create(project=project, member=users["member"], role=20)
        response = _client(users["member"]).get(CANDIDATES_URL.format(slug=workspace.slug))
        assert response.status_code == status.HTTP_403_FORBIDDEN

    def test_a_user_with_no_membership_is_refused(self, workspace, project):
        response = _client(UserFactory()).get(CANDIDATES_URL.format(slug=workspace.slug))
        assert response.status_code == status.HTTP_403_FORBIDDEN

    def test_an_admin_of_another_workspace_is_refused(self, workspace, project):
        outsider = UserFactory()
        WorkspaceMember.objects.create(workspace=WorkspaceFactory(), member=outsider, role=20)
        response = _client(outsider).get(CANDIDATES_URL.format(slug=workspace.slug))
        assert response.status_code == status.HTTP_403_FORBIDDEN


def _seed_project(project):
    _state(project, "Backlog", "backlog", default=True)
    _state(project, "Doing", "started")
    _state(project, "Dropped", "cancelled")
    State.objects.create(project=project, workspace=project.workspace, name="Triage", group="triage", color="#3A3A3A")


@pytest.mark.contract
@pytest.mark.django_db
class TestCreateFromProject:
    def _post(self, user, workspace, **body):
        return _client(user).post(WORKFLOWS_URL.format(slug=workspace.slug), body, format="json")

    def _refused(self, user, workspace, project):
        _seed_project(project)
        response = self._post(user, workspace, name="Nope", source_project_id=str(project.id))
        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert not Workflow.objects.filter(name="Nope").exists()
        assert not WorkflowStatus.objects.filter(workspace=workspace).exists()

    def test_admin_creates_a_workflow_holding_the_project_graph(self, workspace, users, project):
        _seed_project(project)
        response = self._post(users["admin"], workspace, name="From project", source_project_id=str(project.id))
        assert response.status_code == status.HTTP_201_CREATED
        states = response.data["states"]
        assert [state["status"]["name"] for state in states] == ["Backlog", "Doing", "Dropped"]
        assert [state["status"]["name"] for state in states if state["is_initial"]] == ["Backlog"]
        by_id = {state["id"]: state["status"]["name"] for state in states}
        transitions = response.data["transitions"]
        assert sorted(
            ([by_id[source] for source in item["source_ids"]], by_id[item["target_id"]], item["from_any"])
            for item in transitions
        ) == [([], "Backlog", True), ([], "Dropped", True), (["Backlog"], "Doing", False)]
        assert response.data["project_count"] == 0
        assert not ProjectWorkflowScheme.objects.filter(project=project).exists()

    def test_the_creation_is_audited_with_its_source(self, workspace, users, project):
        _seed_project(project)
        response = self._post(users["admin"], workspace, name="From project", source_project_id=str(project.id))
        entry = AuditLog.objects.get(action="workflow.created", target_id=response.data["id"])
        assert entry.after["source_project_id"] == str(project.id)
        assert entry.actor_id == users["admin"].id
        # X1: the graph save leaves its own entry, after the creation one.
        graph_entry = AuditLog.objects.get(action="workflow.graph_updated", target_id=response.data["id"])
        assert graph_entry.created_at > entry.created_at

    def test_without_a_source_the_workflow_is_empty(self, workspace, users):
        response = self._post(users["admin"], workspace, name="Empty")
        assert response.status_code == status.HTTP_201_CREATED
        assert response.data["states"] == []
        assert "source_project_id" not in AuditLog.objects.get(action="workflow.created").after

    @pytest.mark.parametrize("role", ["member", "guest"])
    def test_other_roles_cannot_create_from_a_project(self, workspace, users, project, role):
        self._refused(users[role], workspace, project)

    def test_a_project_admin_who_is_only_a_workspace_member_is_refused(self, workspace, users, project):
        ProjectMember.objects.create(project=project, member=users["member"], role=20)
        self._refused(users["member"], workspace, project)

    def test_a_user_with_no_membership_is_refused(self, workspace, project):
        self._refused(UserFactory(), workspace, project)

    def test_an_admin_of_another_workspace_is_refused(self, workspace, project):
        outsider = UserFactory()
        WorkspaceMember.objects.create(workspace=WorkspaceFactory(), member=outsider, role=20)
        self._refused(outsider, workspace, project)

    def test_a_project_of_another_workspace_looks_missing(self, workspace, users):
        foreign = Project.objects.create(name="Foreign", identifier="FOR", workspace=WorkspaceFactory())
        hidden = self._post(users["admin"], workspace, name="A", source_project_id=str(foreign.id))
        missing = self._post(users["admin"], workspace, name="B", source_project_id=str(uuid4()))
        assert hidden.status_code == missing.status_code == status.HTTP_404_NOT_FOUND
        assert hidden.data == missing.data
        assert not Workflow.objects.filter(workspace=workspace).exists()

    def test_a_deleted_project_looks_missing(self, workspace, users, project):
        _seed_project(project)
        Project.objects.filter(pk=project.pk).update(deleted_at=timezone.now())
        gone = self._post(users["admin"], workspace, name="A", source_project_id=str(project.id))
        missing = self._post(users["admin"], workspace, name="B", source_project_id=str(uuid4()))
        assert gone.status_code == missing.status_code == status.HTTP_404_NOT_FOUND
        assert gone.data == missing.data
        assert not Workflow.objects.filter(workspace=workspace).exists()

    def test_a_malformed_project_id_is_refused(self, workspace, users):
        response = self._post(users["admin"], workspace, name="A", source_project_id=123)
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "source_project_id" in response.data

    def test_too_many_states_create_nothing(self, workspace, users, project):
        State.objects.bulk_create(
            State(
                project=project,
                workspace=workspace,
                name=f"State {index}",
                slug=f"state-{index}",
                group="started",
                color="#3A3A3A",
                sequence=index,
            )
            for index in range(201)
        )
        response = self._post(users["admin"], workspace, name="Huge", source_project_id=str(project.id))
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert not Workflow.objects.filter(name="Huge").exists()
        assert not WorkflowStatus.objects.filter(workspace=workspace).exists()
        assert not AuditLog.objects.filter(action="workflow.created").exists()


def _shape(detail):
    """A graph without its identifiers, to compare a copy with its source."""
    by_id = {state["id"]: state["status"]["name"] for state in detail["states"]}
    states = sorted(
        (state["status"]["id"], state["position_x"], state["position_y"], state["is_initial"])
        for state in detail["states"]
    )
    transitions = sorted(
        (
            item["name"],
            item["from_any"],
            sorted(by_id[source] for source in item["source_ids"]),
            by_id[item["target_id"]],
            sorted((by_id[source], sides["source"], sides["target"]) for source, sides in item["sides"].items()),
            str(item["rules"]),
        )
        for item in detail["transitions"]
    )
    return states, transitions


@pytest.mark.contract
@pytest.mark.django_db
class TestDuplicate:
    @pytest.fixture
    def rich(self, workspace, users):
        workflow = build_workflow(
            workspace,
            "Rich",
            ["To do", "Doing", "Done"],
            [(["To do"], "Doing", {"roles": [20]}), (["Doing"], "Done", None), ("*", "To do", None)],
        )
        source = workflow.states_by_name["To do"].outgoing_sources.get()
        source.source_side, source.target_side = "right", "left"
        source.save()
        return workflow

    def _post(self, user, workspace, pk, **body):
        return _client(user).post(DUPLICATE_URL.format(slug=workspace.slug, pk=pk), body, format="json")

    def _refused(self, user, workspace, rich):
        response = self._post(user, workspace, rich.id, name="Nope")
        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert Workflow.objects.filter(workspace=workspace).count() == 1

    def test_the_copy_matches_its_source(self, workspace, users, rich):
        original = _client(users["admin"]).get(WORKFLOW_URL.format(slug=workspace.slug, pk=rich.id)).data
        response = self._post(users["admin"], workspace, rich.id, name="Copy of Rich")
        assert response.status_code == status.HTTP_201_CREATED
        assert response.data["id"] != str(rich.id)
        assert response.data["name"] == "Copy of Rich"
        assert response.data["project_count"] == 0
        assert _shape(response.data) == _shape(original)
        assert not {state["id"] for state in response.data["states"]} & {state["id"] for state in original["states"]}

    def test_changing_the_copy_leaves_the_source_alone(self, workspace, users, rich):
        client = _client(users["admin"])
        before = _shape(client.get(WORKFLOW_URL.format(slug=workspace.slug, pk=rich.id)).data)
        copy = self._post(users["admin"], workspace, rich.id, name="Copy of Rich").data
        emptied = client.put(
            GRAPH_URL.format(slug=workspace.slug, pk=copy["id"]),
            {"states": [], "transitions": [], "expected_version": copy["version"]},
            format="json",
        )
        assert emptied.status_code == status.HTTP_200_OK
        assert _shape(client.get(WORKFLOW_URL.format(slug=workspace.slug, pk=rich.id)).data) == before

    def test_the_copy_of_a_linked_workflow_is_linked_to_nothing(self, workspace, users, project, software):
        link_project(project, software)
        response = self._post(users["admin"], workspace, software.id, name="Copy")
        assert response.status_code == status.HTTP_201_CREATED
        assert response.data["project_count"] == 0
        assert ProjectWorkflowScheme.objects.count() == 1

    def test_a_rule_citing_a_deactivated_member_is_copied_unchanged(self, workspace, users):
        params = {"user_ids": [str(users["member"].id)]}
        source = build_workflow(workspace, "Named", ["To do", "Done"], [(["To do"], "Done", params)])
        WorkspaceMember.objects.filter(workspace=workspace, member=users["member"]).update(is_active=False)
        response = self._post(users["admin"], workspace, source.id, name="Copy of Named")
        assert response.status_code == status.HTTP_201_CREATED
        assert [item["rules"] for item in response.data["transitions"]] == [
            [{"type": "restrict_actors", "params": params}]
        ]

    def test_the_duplication_is_audited(self, workspace, users, rich):
        response = self._post(users["admin"], workspace, rich.id, name="Copy of Rich")
        entry = AuditLog.objects.get(action="workflow.duplicated")
        assert str(entry.target_id) == response.data["id"]
        assert entry.after["source_workflow_id"] == str(rich.id)
        assert entry.actor_id == users["admin"].id
        # X2: the graph save leaves its own entry, after the duplication one.
        graph_entry = AuditLog.objects.get(action="workflow.graph_updated", target_id=response.data["id"])
        assert graph_entry.created_at > entry.created_at

    def test_a_taken_or_missing_name_is_refused(self, workspace, users, rich):
        taken = self._post(users["admin"], workspace, rich.id, name="rich")
        missing = self._post(users["admin"], workspace, rich.id)
        assert taken.status_code == missing.status_code == status.HTTP_400_BAD_REQUEST
        assert "name" in taken.data and "name" in missing.data
        assert Workflow.objects.filter(workspace=workspace).count() == 1

    @pytest.mark.parametrize("role", ["member", "guest"])
    def test_other_roles_cannot_duplicate(self, workspace, users, rich, role):
        self._refused(users[role], workspace, rich)

    def test_a_project_admin_who_is_only_a_workspace_member_is_refused(self, workspace, users, project, rich):
        ProjectMember.objects.create(project=project, member=users["member"], role=20)
        self._refused(users["member"], workspace, rich)

    def test_a_user_with_no_membership_is_refused(self, workspace, rich):
        self._refused(UserFactory(), workspace, rich)

    def test_an_admin_of_another_workspace_is_refused(self, workspace, rich):
        outsider = UserFactory()
        WorkspaceMember.objects.create(workspace=WorkspaceFactory(), member=outsider, role=20)
        self._refused(outsider, workspace, rich)

    def test_a_workflow_of_another_workspace_looks_missing(self, workspace, users):
        foreign = build_workflow(WorkspaceFactory(), "Foreign", ["A"])
        hidden = self._post(users["admin"], workspace, foreign.id, name="Copy")
        missing = self._post(users["admin"], workspace, uuid4(), name="Copy")
        assert hidden.status_code == missing.status_code == status.HTTP_404_NOT_FOUND
        assert hidden.data == missing.data


@pytest.mark.contract
@pytest.mark.django_db
class TestStaleGraph:
    def _put(self, user, workspace, workflow, payload):
        return _client(user).put(GRAPH_URL.format(slug=workspace.slug, pk=workflow.id), payload, format="json")

    def test_the_detail_carries_the_version(self, workspace, users, software):
        detail = _client(users["member"]).get(WORKFLOW_URL.format(slug=workspace.slug, pk=software.id))
        assert detail.data["version"] == _version(software)

    @pytest.mark.parametrize(
        "value",
        [None, "", "abc", "g" * 64, "A" * 64, 12, ["a" * 64]],
        ids=["missing", "empty", "short", "not-hex", "upper-case", "number", "list"],
    )
    def test_a_missing_or_malformed_version_is_refused(self, workspace, users, software, value):
        payload = _graph_payload(software, [_new_state("Review")])
        if value is None:
            del payload["expected_version"]
        else:
            payload["expected_version"] = value
        response = self._put(users["admin"], workspace, software, payload)
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "expected_version" in response.data
        assert WorkflowState.objects.filter(workflow=software).count() == 2

    def test_a_stale_save_is_refused_and_writes_nothing(self, workspace, users, software):
        stale = _graph_payload(software, drop=["Done"])
        first = self._put(users["admin"], workspace, software, _graph_payload(software, [_new_state("Review")]))
        assert first.status_code == status.HTTP_200_OK, first.data
        audits = AuditLog.objects.filter(action="workflow.graph_updated").count()
        response = self._put(users["admin"], workspace, software, stale)
        assert response.status_code == status.HTTP_409_CONFLICT
        assert response.data == {"graph": ["stale_graph"]}
        assert WorkflowState.objects.filter(workflow=software).count() == 3
        assert AuditLog.objects.filter(action="workflow.graph_updated").count() == audits

    def test_the_version_returned_by_a_save_allows_the_next_one(self, workspace, users, software):
        first = self._put(users["admin"], workspace, software, _graph_payload(software, [_new_state("Review")]))
        payload = _graph_payload(software, [_new_state("Shipped")])
        payload["expected_version"] = first.data["version"]
        second = self._put(users["admin"], workspace, software, payload)
        assert second.status_code == status.HTTP_200_OK, second.data
        assert second.data["version"] != first.data["version"]

    def test_a_shared_status_renamed_from_another_workflow_makes_the_draft_stale(self, workspace, users, software):
        other = build_workflow(workspace, "Bug", ["To do", "Fixed"])
        stale = _graph_payload(software)
        renaming = _graph_payload(other)
        renaming["states"][0]["status"]["name"] = "Todo"
        assert self._put(users["admin"], workspace, other, renaming).status_code == status.HTTP_200_OK
        response = self._put(users["admin"], workspace, software, stale)
        assert response.status_code == status.HTTP_409_CONFLICT
        assert WorkflowStatus.objects.get(pk=software.states_by_name["To do"].status_id).name == "Todo"

    def test_renaming_the_workflow_does_not_make_a_draft_stale(self, workspace, users, software):
        payload = _graph_payload(software, [_new_state("Review")])
        renamed = _client(users["admin"]).patch(
            WORKFLOW_URL.format(slug=workspace.slug, pk=software.id), {"name": "Renamed"}, format="json"
        )
        assert renamed.status_code == status.HTTP_200_OK
        assert self._put(users["admin"], workspace, software, payload).status_code == status.HTTP_200_OK

    @pytest.mark.parametrize("actor", ["project_admin", "member", "guest", "stranger", "foreign_admin"])
    def test_only_workspace_admins_save_even_with_a_valid_version(self, workspace, users, project, software, actor):
        user = _refused_actors(workspace, users, project)[actor]
        response = self._put(user, workspace, software, _graph_payload(software, [_new_state("Review")]))
        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert WorkflowState.objects.filter(workflow=software).count() == 2


def _admin(workspace, name):
    user = UserFactory(display_name=name)
    WorkspaceMember.objects.create(workspace=workspace, member=user, role=20)
    return user


def _editing_key(workflow, user):
    return f"workflow_editing:{workflow.id}:{user.id}"


@pytest.mark.contract
@pytest.mark.django_db
class TestPresence:
    def _post(self, user, workspace, workflow, body=None):
        url = PRESENCE_URL.format(slug=workspace.slug, pk=workflow.id)
        return _client(user).post(url, {"editing": True} if body is None else body, format="json")

    def test_an_editing_admin_is_seen_by_the_others_and_not_by_themself(self, workspace, users, software):
        awa = _admin(workspace, "Awa")
        own = self._post(awa, workspace, software)
        assert own.status_code == status.HTTP_200_OK
        assert own.data == {"editors": []}
        seen = self._post(users["admin"], workspace, software, {"editing": False})
        assert seen.data == {"editors": [{"id": str(awa.id), "display_name": "Awa"}]}

    def test_false_clears_the_signal(self, workspace, users, software):
        awa = _admin(workspace, "Awa")
        self._post(awa, workspace, software)
        self._post(awa, workspace, software, {"editing": False})
        assert self._post(users["admin"], workspace, software, {"editing": False}).data == {"editors": []}

    def test_the_signal_expires_by_itself(self, workspace, users, software):
        self._post(users["admin"], workspace, software)
        assert 0 < cache.ttl(_editing_key(software, users["admin"])) <= 75

    def test_a_signal_on_another_workflow_is_not_listed(self, workspace, users, software):
        other = build_workflow(workspace, "Bug", ["Open"])
        self._post(_admin(workspace, "Awa"), workspace, other)
        assert self._post(users["admin"], workspace, software, {"editing": False}).data == {"editors": []}

    def test_editors_are_sorted_by_name_and_capped_at_ten(self, workspace, users, software):
        for index in range(12):
            cache.set(_editing_key(software, _admin(workspace, f"Admin {11 - index:02d}")), 1, timeout=75)
        names = [item["display_name"] for item in self._post(users["admin"], workspace, software).data["editors"]]
        assert names == [f"Admin {index:02d}" for index in range(10)]

    def test_a_deactivated_admin_is_not_listed(self, workspace, users, software):
        awa = _admin(workspace, "Awa")
        self._post(awa, workspace, software)
        WorkspaceMember.objects.filter(workspace=workspace, member=awa).update(is_active=False)
        assert self._post(users["admin"], workspace, software, {"editing": False}).data == {"editors": []}

    def test_the_identity_comes_from_the_session_never_from_the_body(self, workspace, users, software):
        awa = _admin(workspace, "Awa")
        self._post(users["admin"], workspace, software, {"editing": True, "user_id": str(awa.id)})
        assert cache.get(_editing_key(software, awa)) is None
        assert cache.get(_editing_key(software, users["admin"])) == 1

    @pytest.mark.parametrize(
        "body",
        [{}, {"editing": "yes"}, {"editing": 1}, {"editing": None}, []],
        ids=["missing", "text", "number", "null", "list"],
    )
    def test_a_body_without_a_strict_boolean_is_refused(self, workspace, users, software, body):
        response = self._post(users["admin"], workspace, software, body)
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert cache.get(_editing_key(software, users["admin"])) is None

    @pytest.mark.parametrize("actor", ["project_admin", "member", "guest", "stranger", "foreign_admin"])
    def test_only_workspace_admins_use_the_route(self, workspace, users, project, software, actor):
        user = _refused_actors(workspace, users, project)[actor]
        self._post(_admin(workspace, "Awa"), workspace, software)
        response = self._post(user, workspace, software)
        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert "editors" not in response.data
        assert cache.get(_editing_key(software, user)) is None

    def test_a_workflow_of_another_workspace_looks_missing(self, workspace, users):
        foreign = build_workflow(WorkspaceFactory(), "Foreign", ["A"])
        hidden = self._post(users["admin"], workspace, foreign)
        url = PRESENCE_URL.format(slug=workspace.slug, pk=uuid4())
        missing = _client(users["admin"]).post(url, {"editing": True}, format="json")
        assert hidden.status_code == missing.status_code == status.HTTP_404_NOT_FOUND
        # Same body too: nothing tells a workflow of another workspace from an unknown id (spec 8).
        assert hidden.data == missing.data
        assert cache.get(_editing_key(foreign, users["admin"])) is None

    def test_an_anonymous_caller_is_refused_like_on_the_other_workflow_routes(self, workspace, software):
        response = APIClient().post(
            PRESENCE_URL.format(slug=workspace.slug, pk=software.id), {"editing": True}, format="json"
        )
        detail = APIClient().get(WORKFLOW_URL.format(slug=workspace.slug, pk=software.id))
        assert response.status_code == detail.status_code == status.HTTP_401_UNAUTHORIZED
        assert "editors" not in response.data

    def test_an_admin_demoted_after_signalling_is_no_longer_listed(self, workspace, users, software):
        awa = _admin(workspace, "Awa")
        self._post(awa, workspace, software)
        WorkspaceMember.objects.filter(workspace=workspace, member=awa).update(role=15)
        assert self._post(users["admin"], workspace, software, {"editing": False}).data == {"editors": []}


@pytest.mark.contract
@pytest.mark.django_db
class TestDuplicateTransitions:
    def _arrow(self, software, sources, target):
        key = lambda name: str(software.states_by_name[name].id)  # noqa: E731
        return {
            "name": "",
            "from_any": sources == "*",
            "source_keys": [] if sources == "*" else [key(name) for name in sources],
            "target_key": key(target),
            "rules": [],
        }

    def _put(self, workspace, users, software, transitions):
        payload = _graph_payload(software)
        payload["transitions"] = transitions
        return _client(users["admin"]).put(
            GRAPH_URL.format(slug=workspace.slug, pk=software.id), payload, format="json"
        )

    def test_two_transitions_sharing_a_source_and_a_target_are_refused(self, workspace, users, software):
        arrows = [self._arrow(software, ["To do"], "Done"), self._arrow(software, ["To do"], "Done")]
        response = self._put(workspace, users, software, arrows)
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert response.data == {"graph": ["duplicate_transition"]}

    def test_two_transitions_from_any_state_to_the_same_state_are_refused(self, workspace, users, software):
        arrows = [self._arrow(software, "*", "Done"), self._arrow(software, "*", "Done")]
        response = self._put(workspace, users, software, arrows)
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert response.data == {"graph": ["duplicate_transition"]}

    def test_a_global_and_a_named_transition_to_the_same_state_are_accepted(self, workspace, users, software):
        arrows = [self._arrow(software, "*", "Done"), self._arrow(software, ["To do"], "Done")]
        response = self._put(workspace, users, software, arrows)
        assert response.status_code == status.HTTP_200_OK, response.data
        assert len(response.data["transitions"]) == 2
