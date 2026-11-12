# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import pytest
from django.core.exceptions import ValidationError

from plane.db.models import Issue, Project, State
from plane.tests.factories import IssueTypeFactory, ProjectIssueTypeFactory
from plane.tests.workflow_builders import build_workflow, link_project

pytestmark = [pytest.mark.unit, pytest.mark.django_db]


@pytest.fixture
def ctx(workspace, create_user):
    project = Project.objects.create(name="Home", identifier="HOME", workspace=workspace, created_by=create_user)
    bug = IssueTypeFactory(workspace=workspace, name="Bug")
    ProjectIssueTypeFactory(project=project, issue_type=bug)
    software = build_workflow(workspace, "Software", ["To do", "Done"], [(["To do"], "Done", None)])
    support = build_workflow(workspace, "Support", ["New", "Closed"], [(["New"], "Closed", None)])
    states = link_project(project, software, {bug: support})
    return project, bug, states


def test_without_state_an_item_enters_the_initial_state_of_its_workflow(ctx):
    project, bug, states = ctx
    assert Issue.objects.create(name="Task", project=project).state_id == states["To do"].id
    assert Issue.objects.create(name="Bug", project=project, type=bug).state_id == states["New"].id


def test_a_state_of_another_workflow_is_refused(ctx):
    project, bug, states = ctx
    with pytest.raises(ValidationError):
        Issue.objects.create(name="Bug", project=project, type=bug, state=states["Done"])


def test_a_move_out_of_the_workflow_is_refused_but_arrows_are_not_checked_here(ctx):
    project, _, states = ctx
    issue = Issue.objects.create(name="Task", project=project)
    issue.state = states["Closed"]
    with pytest.raises(ValidationError):
        issue.save()
    issue.refresh_from_db()
    issue.state = states["Done"]
    issue.save()
    # No arrow leads back to "To do": the model checks membership only, the serializers check arrows.
    issue.state = states["To do"]
    issue.save()
    issue.refresh_from_db()
    assert issue.state_id == states["To do"].id


def test_a_type_change_into_a_workflow_without_the_state_is_refused(ctx):
    project, bug, states = ctx
    issue = Issue.objects.create(name="Task", project=project)
    issue.type = bug
    with pytest.raises(ValidationError):
        issue.save()


def test_an_item_created_in_triage_stays_allowed(ctx):
    project, _, _ = ctx
    triage = State.objects.create(name="Triage", project=project, group="triage")
    assert Issue.objects.create(name="Intake", project=project, state=triage).state_id == triage.id


def test_a_managed_item_cannot_move_into_triage(ctx):
    project, _, states = ctx
    triage = State.objects.create(name="Triage", project=project, group="triage")
    issue = Issue.objects.create(name="Task", project=project)
    assert issue.state_id == states["To do"].id
    issue.state = triage
    with pytest.raises(ValidationError):
        issue.save()


def test_an_item_already_in_triage_can_be_saved_in_triage(ctx):
    project, _, _ = ctx
    triage = State.objects.create(name="Triage", project=project, group="triage")
    other = State.objects.create(name="Triage 2", project=project, group="triage")
    issue = Issue.objects.create(name="Intake", project=project, state=triage)
    issue.state = other
    issue.save()
    issue.refresh_from_db()
    assert issue.state_id == other.id


def test_a_free_project_is_untouched(workspace):
    free = Project.objects.create(name="Free", identifier="FREE", workspace=workspace)
    state = State.objects.create(name="Anything", project=free)
    assert Issue.objects.create(name="Free", project=free, state=state).state_id == state.id


def test_saving_other_fields_does_not_recheck(ctx):
    project, _, states = ctx
    issue = Issue.objects.create(name="Task", project=project)
    Issue.objects.filter(pk=issue.pk).update(state=states["Closed"])
    # A fresh load: refresh_from_db does not reset the change tracker.
    issue = Issue.objects.get(pk=issue.pk)
    issue.name = "Renamed"
    issue.save()
