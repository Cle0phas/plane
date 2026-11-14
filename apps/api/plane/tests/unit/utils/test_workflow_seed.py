# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import pytest
from django.utils import timezone

from plane.db.models import Project, State, WorkflowStatus
from plane.utils.workflow_seed import candidate_statuses, graph_from_project, status_color


def make_project(workspace, name, identifier):
    return Project.objects.create(name=name, identifier=identifier, workspace=workspace)


def make_state(project, name, group, color="#3A3A3A", default=False):
    return State.objects.create(
        project=project, workspace=project.workspace, name=name, group=group, color=color, default=default
    )


@pytest.mark.unit
@pytest.mark.django_db
class TestCandidateStatuses:
    def test_each_name_once_with_the_oldest_values(self, workspace):
        first = make_project(workspace, "First", "ONE")
        second = make_project(workspace, "Second", "TWO")
        make_state(first, "Todo", "unstarted", "#111111")
        make_state(second, "TODO", "started", "#222222")
        assert candidate_statuses(workspace.id) == [{"name": "Todo", "color": "#111111", "group": "unstarted"}]

    def test_sorted_by_category_then_name(self, workspace):
        project = make_project(workspace, "First", "ONE")
        make_state(project, "Done", "completed")
        make_state(project, "Review", "started")
        make_state(project, "Build", "started")
        make_state(project, "Backlog", "backlog")
        assert [item["name"] for item in candidate_statuses(workspace.id)] == ["Backlog", "Build", "Review", "Done"]

    def test_existing_statuses_triage_and_deleted_rows_are_left_out(self, workspace):
        project = make_project(workspace, "First", "ONE")
        gone = make_project(workspace, "Gone", "TWO")
        WorkflowStatus.objects.create(workspace=workspace, name="todo", color="#3A3A3A")
        make_state(project, "Todo", "unstarted")
        make_state(project, "Triage", "triage")
        make_state(project, "triage", "started")
        removed = make_state(project, "Removed", "started")
        make_state(gone, "Hidden", "started")
        # Queryset updates: a model delete() would queue the cascade task.
        State.objects.filter(pk=removed.pk).update(deleted_at=timezone.now())
        Project.objects.filter(pk=gone.pk).update(deleted_at=timezone.now())
        make_state(project, "Kept", "started")
        assert [item["name"] for item in candidate_statuses(workspace.id)] == ["Kept"]

    def test_other_workspaces_are_ignored_and_bad_colours_replaced(self, workspace):
        from plane.tests.factories import WorkspaceFactory

        foreign = make_project(WorkspaceFactory(), "Foreign", "FOR")
        make_state(foreign, "Elsewhere", "started")
        project = make_project(workspace, "First", "ONE")
        make_state(project, "Odd", "started", "red")
        assert candidate_statuses(workspace.id) == [{"name": "Odd", "color": "#3A3A3A", "group": "started"}]

    def test_the_list_is_capped(self, workspace, monkeypatch):
        monkeypatch.setattr("plane.utils.workflow_seed.CANDIDATE_LIMIT", 2)
        project = make_project(workspace, "First", "ONE")
        # Created in reverse order: the limit must apply after the sort.
        for name in ("C", "B", "A"):
            make_state(project, name, "started")
        assert [item["name"] for item in candidate_statuses(workspace.id)] == ["A", "B"]

    def test_blank_names_are_not_proposed(self, workspace):
        project = make_project(workspace, "First", "ONE")
        for name in ("", "   "):
            blank = make_state(project, "Placeholder", "started")
            State.objects.filter(pk=blank.pk).update(name=name)
        make_state(project, "Kept", "started")
        assert [item["name"] for item in candidate_statuses(workspace.id)] == ["Kept"]


@pytest.mark.unit
class TestStatusColor:
    def test_a_trailing_newline_is_not_a_valid_colour(self):
        assert status_color("#123456\n") == "#3A3A3A"

    def test_a_strict_colour_is_kept(self):
        assert status_color("#12abEF") == "#12abEF"


def names(graph, keys):
    by_key = {state["key"]: state["status"]["name"] for state in graph["states"]}
    return [by_key[key] for key in keys]


@pytest.mark.unit
@pytest.mark.django_db
class TestGraphFromProject:
    def _project(self, workspace):
        project = make_project(workspace, "TEST2", "TEST2")
        make_state(project, "Backlog", "backlog", default=True)
        make_state(project, "Todo", "unstarted")
        make_state(project, "In Progress", "started")
        make_state(project, "Done", "completed")
        make_state(project, "Cancelled", "cancelled")
        make_state(project, "Ready for dev", "started")
        make_state(project, "Triage", "triage")
        return project

    def test_states_follow_category_then_project_rank(self, workspace):
        graph = graph_from_project(self._project(workspace))
        assert [state["status"]["name"] for state in graph["states"]] == [
            "Backlog",
            "Todo",
            "In Progress",
            "Ready for dev",
            "Done",
            "Cancelled",
        ]
        assert [state["position_x"] for state in graph["states"]] == [0, 240, 480, 720, 960, 1200]
        assert {state["position_y"] for state in graph["states"]} == {0}
        assert [state["status"]["name"] for state in graph["states"] if state["is_initial"]] == ["Backlog"]

    def test_chain_and_global_transitions(self, workspace):
        graph = graph_from_project(self._project(workspace))
        chain = [item for item in graph["transitions"] if not item["from_any"]]
        assert [names(graph, [*item["source_keys"], item["target_key"]]) for item in chain] == [
            ["Backlog", "Todo"],
            ["Todo", "In Progress"],
            ["In Progress", "Ready for dev"],
            ["Ready for dev", "Done"],
        ]
        anywhere = [item for item in graph["transitions"] if item["from_any"]]
        assert names(graph, [item["target_key"] for item in anywhere]) == ["Backlog", "Cancelled"]
        assert all(item["source_keys"] == [] and item["rules"] == [] for item in anywhere)

    def test_the_first_state_starts_when_the_default_is_missing_or_cancelled(self, workspace):
        project = make_project(workspace, "First", "ONE")
        make_state(project, "Todo", "unstarted")
        make_state(project, "Dropped", "cancelled", default=True)
        graph = graph_from_project(project)
        assert [state["status"]["name"] for state in graph["states"] if state["is_initial"]] == ["Todo"]

    def test_an_existing_status_is_reused_and_a_new_one_keeps_the_state_values(self, workspace):
        existing = WorkflowStatus.objects.create(workspace=workspace, name="todo", color="#123456")
        project = make_project(workspace, "First", "ONE")
        make_state(project, "Todo", "unstarted", "#AAAAAA")
        make_state(project, "Review", "started", "#BBBBBB")
        graph = graph_from_project(project)
        assert graph["states"][0]["status"] == {"id": str(existing.id), "name": "todo", "color": "#123456"}
        assert graph["states"][1]["status"] == {"name": "Review", "color": "#BBBBBB", "group": "started"}

    def test_names_differing_by_case_and_reserved_names_give_one_state(self, workspace):
        project = make_project(workspace, "First", "ONE")
        make_state(project, "Todo", "unstarted")
        make_state(project, "TODO", "started")
        make_state(project, "triage", "started")
        assert [state["status"]["name"] for state in graph_from_project(project)["states"]] == ["Todo"]

    def test_an_empty_project_gives_an_empty_graph(self, workspace):
        assert graph_from_project(make_project(workspace, "First", "ONE")) == {"states": [], "transitions": []}
