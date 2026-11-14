# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import pytest
from django.utils import timezone

from plane.db.models import Project, State, WorkflowStatus
from plane.utils.workflow_seed import candidate_statuses


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
        for name in ("A", "B", "C"):
            make_state(project, name, "started")
        assert [item["name"] for item in candidate_statuses(workspace.id)] == ["A", "B"]
