# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import pytest

from plane.api.serializers import IntakeIssueUpdateSerializer
from plane.app.serializers import IntakeIssueSerializer
from plane.db.models import Intake, IntakeIssue, Issue, Project, State
from plane.db.models.intake import IntakeIssueStatus
from plane.tests.factories import IssueTypeFactory, ProjectIssueTypeFactory
from plane.tests.workflow_builders import build_workflow, link_project

pytestmark = [pytest.mark.unit, pytest.mark.django_db]


@pytest.fixture
def make_intake_issue(workspace, create_user):
    def make(project, issue_type=None):
        triage = State.all_state_objects.get_or_create(
            name="Triage", project=project, defaults={"group": "triage", "color": "#3A3A3A"}
        )[0]
        intake = Intake.objects.get_or_create(name="Intake", project=project, workspace=workspace)[0]
        issue = Issue.objects.create(name="Incoming", project=project, state=triage, type=issue_type)
        return IntakeIssue.objects.create(
            intake=intake, issue=issue, project=project, workspace=workspace, status=IntakeIssueStatus.PENDING
        )

    return make


def _accept(serializer_class, intake_issue):
    serializer = serializer_class(intake_issue, data={"status": IntakeIssueStatus.ACCEPTED}, partial=True)
    assert serializer.is_valid(), serializer.errors
    serializer.save()
    intake_issue.issue.refresh_from_db()
    return intake_issue.issue.state


@pytest.mark.parametrize("serializer_class", [IntakeIssueSerializer, IntakeIssueUpdateSerializer])
def test_accepting_enters_the_initial_state_of_the_item_workflow(
    workspace, create_user, make_intake_issue, serializer_class
):
    project = Project.objects.create(name="Home", identifier="HOME", workspace=workspace, created_by=create_user)
    bug = IssueTypeFactory(workspace=workspace, name="Bug")
    ProjectIssueTypeFactory(project=project, issue_type=bug)
    software = build_workflow(workspace, "Software", ["To do", "Done"], [(["To do"], "Done", None)])
    support = build_workflow(workspace, "Support", ["New", "Closed"], [(["New"], "Closed", None)])
    states = link_project(project, software, {bug: support})
    assert _accept(serializer_class, make_intake_issue(project, bug)) == states["New"]
    assert _accept(serializer_class, make_intake_issue(project)) == states["To do"]


@pytest.mark.parametrize("serializer_class", [IntakeIssueSerializer, IntakeIssueUpdateSerializer])
def test_a_free_project_still_uses_its_default_state(workspace, create_user, make_intake_issue, serializer_class):
    project = Project.objects.create(name="Free", identifier="FREE", workspace=workspace, created_by=create_user)
    default = State.objects.create(name="Backlog", project=project, default=True)
    assert _accept(serializer_class, make_intake_issue(project)) == default
