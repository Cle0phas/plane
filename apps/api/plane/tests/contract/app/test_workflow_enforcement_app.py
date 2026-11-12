# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from types import SimpleNamespace
from unittest import mock

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from plane.db.models import DraftIssue, Intake, IntakeIssue, Issue, Project, ProjectMember, State, WorkspaceMember
from plane.tests.factories import IssueTypeFactory, ProjectIssueTypeFactory, UserFactory
from plane.tests.workflow_builders import build_workflow, link_project

ISSUES_URL = "/api/workspaces/{slug}/projects/{project_id}/issues/"
ISSUE_URL = "/api/workspaces/{slug}/projects/{project_id}/issues/{issue_id}/"
REFUSED = {"workflow": ["transition_not_allowed"]}


def _client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def ctx(db, workspace, create_user):
    member = UserFactory()
    WorkspaceMember.objects.create(workspace=workspace, member=member, role=15)
    project = Project.objects.create(name="Home", identifier="HOME", workspace=workspace, created_by=create_user)
    ProjectMember.objects.create(project=project, member=create_user, role=20)
    ProjectMember.objects.create(project=project, member=member, role=15)
    bug = IssueTypeFactory(workspace=workspace, name="Bug")
    ProjectIssueTypeFactory(project=project, issue_type=bug)
    software = build_workflow(
        workspace,
        "Software",
        ["To do", "Doing", "Done", "Cancelled"],
        [(["To do"], "Doing", None), (["Doing"], "Done", {"roles": [20]}), ("*", "Cancelled", None)],
    )
    support = build_workflow(workspace, "Support", ["New", "Doing", "Closed"], [(["New"], "Closed", None)])
    states = link_project(project, software, {bug: support})
    return SimpleNamespace(
        workspace=workspace,
        project=project,
        admin=create_user,
        member=member,
        bug=bug,
        states=states,
        issues_url=ISSUES_URL.format(slug=workspace.slug, project_id=project.id),
    )


def _issue(ctx, state_name, **kwargs):
    return Issue.objects.create(name="Item", project=ctx.project, state=ctx.states[state_name], **kwargs)


def _patch(ctx, user, issue, data):
    url = ISSUE_URL.format(slug=ctx.workspace.slug, project_id=ctx.project.id, issue_id=issue.id)
    return _client(user).patch(url, data, format="json")


@pytest.mark.contract
@pytest.mark.django_db
class TestCreation:
    def test_a_new_item_enters_the_initial_state_of_its_workflow(self, ctx, mock_celery):
        plain = _client(ctx.member).post(ctx.issues_url, {"name": "Task"}, format="json")
        bug = _client(ctx.member).post(ctx.issues_url, {"name": "Bug", "type_id": str(ctx.bug.id)}, format="json")
        assert plain.status_code == bug.status_code == status.HTTP_201_CREATED, (plain.data, bug.data)
        assert Issue.objects.get(pk=plain.data["id"]).state_id == ctx.states["To do"].id
        assert Issue.objects.get(pk=bug.data["id"]).state_id == ctx.states["New"].id

    def test_another_state_at_creation_is_refused(self, ctx, mock_celery):
        response = _client(ctx.admin).post(
            ctx.issues_url, {"name": "Shortcut", "state_id": str(ctx.states["Done"].id)}, format="json"
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert response.data == REFUSED
        assert not Issue.objects.filter(name="Shortcut").exists()


@pytest.mark.contract
@pytest.mark.django_db
class TestTransitions:
    def test_an_arrow_allows_the_move(self, ctx, mock_celery):
        issue = _issue(ctx, "To do")
        response = _patch(ctx, ctx.member, issue, {"state_id": str(ctx.states["Doing"].id)})
        assert response.status_code == status.HTTP_204_NO_CONTENT, response.data
        issue.refresh_from_db()
        assert issue.state_id == ctx.states["Doing"].id

    def test_every_refusal_looks_the_same(self, ctx, mock_celery):
        stray = State.objects.create(name="Stray", project=ctx.project)
        no_arrow_issue, no_right_issue, outside_issue = _issue(ctx, "To do"), _issue(ctx, "Doing"), _issue(ctx, "To do")
        no_arrow = _patch(ctx, ctx.admin, no_arrow_issue, {"state_id": str(ctx.states["Done"].id)})
        no_right = _patch(ctx, ctx.member, no_right_issue, {"state_id": str(ctx.states["Done"].id)})
        outside = _patch(ctx, ctx.admin, outside_issue, {"state_id": str(stray.id)})
        assert no_arrow.status_code == no_right.status_code == outside.status_code == status.HTTP_400_BAD_REQUEST
        assert no_arrow.data == no_right.data == outside.data == REFUSED
        assert mock_celery.call_count == 0
        for issue, name in ((no_arrow_issue, "To do"), (no_right_issue, "Doing"), (outside_issue, "To do")):
            issue.refresh_from_db()
            assert issue.state_id == ctx.states[name].id

    def test_the_role_rule_admits_the_admin(self, ctx, mock_celery):
        issue = _issue(ctx, "Doing")
        assert (
            _patch(ctx, ctx.admin, issue, {"state_id": str(ctx.states["Done"].id)}).status_code
            == status.HTTP_204_NO_CONTENT
        )

    def test_a_global_transition_works_from_anywhere(self, ctx, mock_celery):
        issue = _issue(ctx, "Doing")
        response = _patch(ctx, ctx.member, issue, {"state_id": str(ctx.states["Cancelled"].id)})
        assert response.status_code == status.HTTP_204_NO_CONTENT

    def test_a_free_project_is_not_controlled(self, ctx, workspace, mock_celery):
        free = Project.objects.create(name="Free", identifier="FREE", workspace=workspace)
        ProjectMember.objects.create(project=free, member=ctx.member, role=15)
        a = State.objects.create(name="A", project=free)
        b = State.objects.create(name="B", project=free)
        issue = Issue.objects.create(name="Free", project=free, state=a)
        url = ISSUE_URL.format(slug=workspace.slug, project_id=free.id, issue_id=issue.id)
        assert (
            _client(ctx.member).patch(url, {"state_id": str(b.id)}, format="json").status_code
            == status.HTTP_204_NO_CONTENT
        )


@pytest.mark.contract
@pytest.mark.django_db
class TestTypeChange:
    def test_a_type_change_needing_an_arrival_state_is_refused_without_one(self, ctx, mock_celery):
        issue = _issue(ctx, "To do")
        before = issue.type_id
        response = _patch(ctx, ctx.member, issue, {"type_id": str(ctx.bug.id)})
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert response.data == {"workflow": ["arrival_state_required"]}
        issue.refresh_from_db()
        assert (issue.type_id, issue.state_id) == (before, ctx.states["To do"].id)

    def test_a_type_change_with_an_arrival_state(self, ctx, mock_celery):
        issue = _issue(ctx, "To do")
        response = _patch(
            ctx, ctx.member, issue, {"type_id": str(ctx.bug.id), "state_id": str(ctx.states["Closed"].id)}
        )
        assert response.status_code == status.HTTP_204_NO_CONTENT, response.data
        issue.refresh_from_db()
        assert (issue.type_id, issue.state_id) == (ctx.bug.id, ctx.states["Closed"].id)

    def test_a_type_change_keeps_a_shared_state(self, ctx, mock_celery):
        issue = _issue(ctx, "Doing")
        assert _patch(ctx, ctx.member, issue, {"type_id": str(ctx.bug.id)}).status_code == status.HTTP_204_NO_CONTENT


@pytest.mark.contract
@pytest.mark.django_db
class TestDraftConversion:
    @pytest.fixture(autouse=True)
    def _no_side_effects(self, mock_celery):
        with (
            mock.patch("plane.app.views.workspace.draft.base_host", return_value="http://testserver"),
            mock.patch("plane.db.mixins.soft_delete_related_objects"),
        ):
            yield

    def _convert(self, ctx, data):
        draft = DraftIssue(name="Draft", project=ctx.project, workspace=ctx.workspace)
        draft.save(created_by_id=ctx.admin.id)
        return _client(ctx.admin).post(
            f"/api/workspaces/{ctx.workspace.slug}/draft-to-issue/{draft.id}/", {"name": "Draft", **data}, format="json"
        )

    def test_a_converted_draft_enters_the_initial_state(self, ctx):
        response = self._convert(ctx, {})
        assert response.status_code == status.HTTP_201_CREATED, response.data
        assert Issue.objects.get(name="Draft").state_id == ctx.states["To do"].id

    def test_a_converted_draft_cannot_skip_the_workflow(self, ctx):
        response = self._convert(ctx, {"state_id": str(ctx.states["Done"].id)})
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert response.data == REFUSED


@pytest.mark.contract
@pytest.mark.django_db
class TestIntake:
    def test_a_managed_item_cannot_be_moved_back_into_triage(self, ctx, mock_celery):
        project = ctx.project
        project.intake_view = True
        project.save()
        triage = State.objects.create(name="Triage", group="triage", project=project)
        intake = Intake.objects.create(name="Intake", project=project, workspace=ctx.workspace, is_default=True)
        issue = _issue(ctx, "Doing")
        IntakeIssue.objects.create(intake=intake, issue=issue, project=project, workspace=ctx.workspace)
        response = _client(ctx.admin).patch(
            f"/api/workspaces/{ctx.workspace.slug}/projects/{project.id}/intake-issues/{issue.id}/",
            {"issue": {"state_id": str(triage.id)}},
            format="json",
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST, response.data
        assert response.data == REFUSED
        issue.refresh_from_db()
        assert issue.state_id == ctx.states["Doing"].id
