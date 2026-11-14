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
    ProjectWorkflowScheme,
    State,
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
CANDIDATES_URL = "/api/workspaces/{slug}/workflow-statuses/candidates/"
DUPLICATE_URL = "/api/workspaces/{slug}/workflows/{pk}/duplicate/"


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
            GRAPH_URL.format(slug=workspace.slug, pk=copy["id"]), {"states": [], "transitions": []}, format="json"
        )
        assert emptied.status_code == status.HTTP_200_OK
        assert _shape(client.get(WORKFLOW_URL.format(slug=workspace.slug, pk=rich.id)).data) == before

    def test_the_copy_of_a_linked_workflow_is_linked_to_nothing(self, workspace, users, project, software):
        link_project(project, software)
        response = self._post(users["admin"], workspace, software.id, name="Copy")
        assert response.data["project_count"] == 0
        assert ProjectWorkflowScheme.objects.count() == 1

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
