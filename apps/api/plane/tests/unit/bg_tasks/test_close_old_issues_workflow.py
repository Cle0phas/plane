# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from datetime import timedelta

import pytest
from django.utils import timezone

from plane.bgtasks.issue_automation_task import close_old_issues
from plane.db.models import Issue, Project, State, WorkflowStatus
from plane.tests.factories import ProjectFactory, WorkspaceFactory
from plane.tests.workflow_builders import build_workflow, link_project

pytestmark = [pytest.mark.unit, pytest.mark.django_db]


@pytest.fixture
def stale(workspace, create_user):
    def make(project, state):
        issue = Issue.objects.create(name="Stale", project=project, state=state)
        Issue.objects.filter(pk=issue.pk).update(updated_at=timezone.now() - timedelta(days=90))
        return issue

    return make


def _project(workspace, create_user, identifier):
    return Project.objects.create(
        name=identifier, identifier=identifier, workspace=workspace, created_by=create_user, close_in=1
    )


def test_a_free_project_closes_into_its_own_cancelled_state(workspace, create_user, stale, mock_celery):
    foreign_project = ProjectFactory(workspace=WorkspaceFactory())
    foreign = State.objects.create(name="Gone", project=foreign_project, group="cancelled")
    State.objects.filter(pk=foreign.pk).update(sequence=1)
    project = _project(workspace, create_user, "FREE")
    open_state = State.objects.create(name="Open", project=project, group="started")
    cancelled = State.objects.create(name="Cancelled", project=project, group="cancelled")
    issue = stale(project, open_state)

    close_old_issues()

    issue.refresh_from_db()
    assert issue.state_id == cancelled.id


def test_under_a_workflow_only_a_rule_free_global_transition_to_a_cancelled_state_closes(
    workspace, create_user, stale, mock_celery
):
    closing = build_workflow(workspace, "Closing", ["Open", "Dropped"], [("*", "Dropped", None)])
    guarded = build_workflow(workspace, "Guarded", ["Start", "Shelved"], [("*", "Shelved", {"roles": [20]})])
    WorkflowStatus.objects.filter(name__in=["Dropped", "Shelved"]).update(group="cancelled")
    first = _project(workspace, create_user, "ONE")
    second = _project(workspace, create_user, "TWO")
    first_states = link_project(first, closing)
    second_states = link_project(second, guarded)
    closed = stale(first, first_states["Open"])
    kept = stale(second, second_states["Start"])

    close_old_issues()

    closed.refresh_from_db()
    kept.refresh_from_db()
    assert closed.state_id == first_states["Dropped"].id
    assert kept.state_id == second_states["Start"].id


def test_without_any_closing_state_nothing_moves(workspace, create_user, stale, mock_celery):
    project = _project(workspace, create_user, "NONE")
    open_state = State.objects.create(name="Open", project=project, group="started")
    issue = stale(project, open_state)

    close_old_issues()

    issue.refresh_from_db()
    assert issue.state_id == open_state.id
