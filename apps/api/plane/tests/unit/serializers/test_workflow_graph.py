# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import pytest

from plane.app.serializers import WorkflowGraphInputSerializer
from plane.db.models import (
    AuditLog,
    Issue,
    Project,
    State,
    WorkflowState,
    WorkflowStatus,
    WorkflowTransition,
    WorkspaceMember,
)
from plane.tests.factories import UserFactory, WorkspaceFactory
from plane.tests.workflow_builders import build_workflow, link_project
from plane.utils.workflow_sync import SchemeError
from plane.utils.workflow_graph import GraphError, save_workflow_graph, workflow_graph

pytestmark = [pytest.mark.unit, pytest.mark.django_db]


def _state(key, name, initial=False, status_id=None, group=None):
    status = {"name": name, "color": "#3A3A3A", "group": group}
    if status_id:
        status["id"] = str(status_id)
    return {"key": key, "status": status, "position_x": 0, "position_y": 0, "is_initial": initial}


def _transition(sources, target, rules=None, from_any=False):
    return {"name": "", "from_any": from_any, "source_keys": sources, "target_key": target, "rules": rules or []}


def _validate(workspace, data):
    serializer = WorkflowGraphInputSerializer(data=data, context={"workspace_id": workspace.id})
    return serializer.is_valid(), serializer


class TestGraphInput:
    def test_a_valid_graph_passes(self, workspace):
        valid, serializer = _validate(
            workspace,
            {"states": [_state("a", "Open", True), _state("b", "Shipped")], "transitions": [_transition(["a"], "b")]},
        )
        assert valid, serializer.errors

    @pytest.mark.parametrize(
        "data, code",
        [
            ({"states": [_state("a", "Open"), _state("b", "Done")], "transitions": []}, "initial_state_required"),
            (
                {"states": [_state("a", "Open", True), _state("b", "Done", True)], "transitions": []},
                "initial_state_required",
            ),
            ({"states": [_state("a", "Open", True), _state("a", "Done")], "transitions": []}, "duplicate_state_key"),
            ({"states": [_state("a", "Open", True), _state("b", "OPEN")], "transitions": []}, "duplicate_status_name"),
            ({"states": [_state("a", "Triage", True)], "transitions": []}, "reserved_status_name"),
            ({"states": [_state("a", "Open", True)], "transitions": [_transition(["a"], "zz")]}, "invalid_transition"),
            (
                {"states": [_state("a", "Open", True), _state("b", "B")], "transitions": [_transition([], "b")]},
                "invalid_transition",
            ),
            (
                {
                    "states": [_state("a", "Open", True), _state("b", "B")],
                    "transitions": [_transition(["a"], "b", from_any=True)],
                },
                "invalid_transition",
            ),
            ({"states": [_state("a", "Open", True)], "transitions": [_transition(["a"], "a")]}, "invalid_transition"),
        ],
    )
    def test_structural_errors_have_one_code(self, workspace, data, code):
        valid, serializer = _validate(workspace, data)
        assert not valid
        assert serializer.errors["graph"] == [code]

    def test_the_same_status_cannot_appear_twice(self, workspace):
        status = WorkflowStatus.objects.create(workspace=workspace, name="Open", color="#3A3A3A")
        valid, serializer = _validate(
            workspace,
            {
                "states": [_state("a", "Open", True, status.id), _state("b", "Other", False, status.id)],
                "transitions": [],
            },
        )
        assert not valid and serializer.errors["graph"] == ["duplicate_status"]

    @pytest.mark.parametrize(
        "params",
        [
            {},
            {"roles": [99]},
            {"roles": [20], "admins": True},
            {"assignee": "yes"},
            {"user_ids": [123]},
        ],
    )
    def test_rule_params_are_strict(self, workspace, params):
        valid, serializer = _validate(
            workspace,
            {
                "states": [_state("a", "Open", True), _state("b", "B")],
                "transitions": [_transition(["a"], "b", [{"type": "restrict_actors", "params": params}])],
            },
        )
        assert not valid
        assert serializer.errors["graph"] == ["invalid_rule"]

    @pytest.mark.parametrize("value", ["NaN", float("nan"), float("inf"), True, "1"])
    def test_positions_are_finite_numbers(self, workspace, value):
        state = _state("a", "Open", True)
        state["position_x"] = value
        valid, _ = _validate(workspace, {"states": [state], "transitions": []})
        assert not valid

    def test_named_users_must_be_active_members_of_the_workspace(self, workspace):
        member = UserFactory()
        WorkspaceMember.objects.create(workspace=workspace, member=member, role=15)
        outsider = UserFactory()
        for user, expected in ((member, True), (outsider, False)):
            valid, _ = _validate(
                workspace,
                {
                    "states": [_state("a", "Open", True), _state("b", "B")],
                    "transitions": [
                        _transition(["a"], "b", [{"type": "restrict_actors", "params": {"user_ids": [str(user.id)]}}])
                    ],
                },
            )
            assert valid is expected

    def test_bounds(self, workspace):
        states = [_state(str(index), f"S{index}", index == 0) for index in range(201)]
        valid, _ = _validate(workspace, {"states": states, "transitions": []})
        assert not valid


class TestSaveGraph:
    @pytest.fixture
    def project(self, workspace, create_user):
        return Project.objects.create(name="Home", identifier="HOME", workspace=workspace, created_by=create_user)

    def _save(self, workflow, data, actor):
        valid, serializer = _validate(workflow.workspace, data)
        assert valid, serializer.errors
        return save_workflow_graph(workflow=workflow, graph=serializer.validated_data, actor_id=actor.id)

    def test_new_statuses_states_and_transitions_are_created(self, workspace, create_user):
        workflow = build_workflow(workspace, "Flow", ["Open"])
        open_state = workflow.states_by_name["Open"]
        graph = self._save(
            workflow,
            {
                "states": [_state(str(open_state.id), "Open", True, open_state.status_id), _state("new", "Shipped")],
                "transitions": [_transition([str(open_state.id)], "new")],
            },
            create_user,
        )
        assert [state["status"]["name"] for state in graph["states"]] == ["Open", "Shipped"]
        assert graph["transitions"][0]["source_ids"] == [str(open_state.id)]
        assert WorkflowStatus.objects.get(name="Shipped").group == "completed"
        entry = AuditLog.objects.get(action="workflow.graph_updated")
        assert entry.target_id == workflow.id
        assert [state["status"]["name"] for state in entry.before["states"]] == ["Open"]

    def test_editing_a_shared_status_reaches_every_workflow_and_project(self, workspace, project, create_user):
        first = build_workflow(workspace, "First", ["Open", "Done"], [(["Open"], "Done", None)])
        build_workflow(workspace, "Second", ["Open"])
        link_project(project, first)
        states = first.states_by_name
        self._save(
            first,
            {
                "states": [
                    _state(str(states["Open"].id), "Ready", True, states["Open"].status_id),
                    _state(str(states["Done"].id), "Done", False, states["Done"].status_id),
                ],
                "transitions": [_transition([str(states["Open"].id)], str(states["Done"].id))],
            },
            create_user,
        )
        assert WorkflowStatus.objects.get(pk=states["Open"].status_id).name == "Ready"
        assert State.objects.filter(project=project, name="Ready").exists()

    def test_a_status_added_reaches_linked_projects(self, workspace, project, create_user):
        workflow = build_workflow(workspace, "Flow", ["Open"])
        link_project(project, workflow)
        open_state = workflow.states_by_name["Open"]
        self._save(
            workflow,
            {
                "states": [_state(str(open_state.id), "Open", True, open_state.status_id), _state("n", "Review")],
                "transitions": [_transition([str(open_state.id)], "n")],
            },
            create_user,
        )
        assert State.objects.filter(project=project, name="Review", workflow_status__isnull=False).exists()

    def test_removing_a_status_holding_items_is_refused_with_counts(self, workspace, project, create_user):
        workflow = build_workflow(workspace, "Flow", ["Open", "Done"], [(["Open"], "Done", None)])
        states = link_project(project, workflow)
        Issue.objects.create(name="Item", project=project, state=states["Done"])
        open_state = workflow.states_by_name["Open"]
        with pytest.raises(GraphError) as error:
            self._save(
                workflow,
                {"states": [_state(str(open_state.id), "Open", True, open_state.status_id)], "transitions": []},
                create_user,
            )
        assert error.value.code == "status_in_use"
        assert error.value.details == [{"project_id": str(project.id), "project_name": "Home", "issue_count": 1}]

    def test_removing_an_empty_status_drops_its_project_state(self, workspace, project, create_user):
        workflow = build_workflow(workspace, "Flow", ["Open", "Done"], [(["Open"], "Done", None)])
        states = link_project(project, workflow)
        open_state = workflow.states_by_name["Open"]
        self._save(
            workflow,
            {"states": [_state(str(open_state.id), "Open", True, open_state.status_id)], "transitions": []},
            create_user,
        )
        assert not WorkflowState.objects.filter(workflow=workflow, status__name="Done").exists()
        assert not WorkflowTransition.objects.filter(workflow=workflow).exists()
        assert not State.objects.filter(pk=states["Done"].pk).exists()

    def test_an_existing_state_keeps_its_status(self, workspace, create_user):
        workflow = build_workflow(workspace, "Flow", ["Open"])
        other = WorkflowStatus.objects.create(workspace=workspace, name="Other", color="#3A3A3A")
        with pytest.raises(GraphError) as error:
            self._save(
                workflow,
                {
                    "states": [_state(str(workflow.states_by_name["Open"].id), "Other", True, other.id)],
                    "transitions": [],
                },
                create_user,
            )
        assert error.value.code == "status_changed"

    def test_a_status_of_another_workspace_is_refused(self, workspace, create_user):
        workflow = build_workflow(workspace, "Flow", ["Open"])
        foreign = WorkflowStatus.objects.create(workspace=WorkspaceFactory(), name="Foreign", color="#3A3A3A")
        with pytest.raises(GraphError) as error:
            self._save(workflow, {"states": [_state("x", "Foreign", True, foreign.id)], "transitions": []}, create_user)
        assert error.value.code == "invalid_status"

    def test_the_workspace_status_bound(self, workspace, create_user, monkeypatch):
        monkeypatch.setattr("plane.utils.workflow_graph.MAX_STATUSES_PER_WORKSPACE", 1)
        workflow = build_workflow(workspace, "Flow", ["Open"])
        open_state = workflow.states_by_name["Open"]
        with pytest.raises(GraphError) as error:
            self._save(
                workflow,
                {
                    "states": [_state(str(open_state.id), "Open", True, open_state.status_id), _state("n", "New")],
                    "transitions": [],
                },
                create_user,
            )
        assert error.value.code == "status_limit"

    def test_snapshot_shape(self, workspace):
        workflow = build_workflow(workspace, "Flow", ["Open", "Done"], [(["Open"], "Done", {"creator": True})])
        graph = workflow_graph(workflow)
        assert graph["transitions"][0]["rules"] == [{"type": "restrict_actors", "params": {"creator": True}}]
        assert graph["states"][0]["is_initial"] is True


class TestEmptyAndResyncFailures:
    def test_an_empty_graph_is_refused_for_a_linked_workflow(self, workspace, create_user):
        project = Project.objects.create(name="Home", identifier="HOME", workspace=workspace, created_by=create_user)
        workflow = build_workflow(workspace, "Flow", ["Open"])
        link_project(project, workflow)
        with pytest.raises(GraphError) as error:
            save_workflow_graph(workflow=workflow, graph={"states": [], "transitions": []}, actor_id=create_user.id)
        assert error.value.code == "initial_state_required"
        assert WorkflowState.objects.filter(workflow=workflow).count() == 1

    def test_an_empty_graph_is_saved_for_an_unlinked_workflow(self, workspace, create_user):
        workflow = build_workflow(workspace, "Flow", ["Open"])
        graph = save_workflow_graph(workflow=workflow, graph={"states": [], "transitions": []}, actor_id=create_user.id)
        assert graph["states"] == []

    def test_a_scheme_error_from_the_resync_becomes_a_graph_error(self, workspace, create_user, monkeypatch):
        workflow = build_workflow(workspace, "Flow", ["Open"])
        open_state = workflow.states_by_name["Open"]

        def fail(workflow_id):
            raise SchemeError("status_in_use", [])

        monkeypatch.setattr("plane.utils.workflow_graph.resync_workflow", fail)
        valid, serializer = _validate(
            workspace, {"states": [_state(str(open_state.id), "Open", True, open_state.status_id)], "transitions": []}
        )
        assert valid
        with pytest.raises(GraphError) as error:
            save_workflow_graph(workflow=workflow, graph=serializer.validated_data, actor_id=create_user.id)
        assert error.value.code == "status_in_use"
