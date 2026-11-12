# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""R9: a work item only takes an active type of its own workspace that is enabled in its project."""

from types import SimpleNamespace
from unittest import mock
from uuid import uuid4

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from plane.db.models import DraftIssue, Intake, Issue, IssueType, Project, ProjectIssueType, ProjectMember
from plane.tests.factories import IssueTypeFactory, WorkspaceFactory

ISSUES_URL = "/api/workspaces/{slug}/projects/{project_id}/issues/"
ISSUE_URL = "/api/workspaces/{slug}/projects/{project_id}/issues/{issue_id}/"
DRAFTS_URL = "/api/workspaces/{slug}/draft-issues/"
INTAKE_URL = "/api/workspaces/{slug}/projects/{project_id}/intake-issues/"


@pytest.fixture
def ctx(db, workspace, create_user):
    project = Project.objects.create(name="Home", identifier="HOME", workspace=workspace, created_by=create_user)
    ProjectMember.objects.create(project=project, member=create_user, role=20)
    bug = IssueTypeFactory(workspace=workspace, name="Bug")
    ProjectIssueType.objects.create(project=project, issue_type=bug)
    client = APIClient()
    client.force_authenticate(user=create_user)
    return SimpleNamespace(
        client=client,
        user=create_user,
        workspace=workspace,
        project=project,
        default_type=IssueType.objects.get(workspace=workspace, is_default=True),
        bug=bug,
        not_enabled=IssueTypeFactory(workspace=workspace, name="Story"),
        foreign=IssueTypeFactory(workspace=WorkspaceFactory(), name="Foreign"),
        issues_url=ISSUES_URL.format(slug=workspace.slug, project_id=project.id),
    )


def _issue_url(ctx, issue):
    return ISSUE_URL.format(slug=ctx.workspace.slug, project_id=ctx.project.id, issue_id=issue.id)


@pytest.mark.contract
@pytest.mark.django_db
class TestCreateWorkItemType:
    def test_without_type_the_project_default_is_used(self, ctx, mock_celery):
        response = ctx.client.post(ctx.issues_url, {"name": "Plain"}, format="json")
        assert response.status_code == status.HTTP_201_CREATED, response.data
        assert Issue.objects.get(pk=response.data["id"]).type_id == ctx.default_type.id
        assert str(response.data["type_id"]) == str(ctx.default_type.id)

    def test_an_enabled_type_is_kept(self, ctx, mock_celery):
        response = ctx.client.post(ctx.issues_url, {"name": "Bug", "type_id": str(ctx.bug.id)}, format="json")
        assert response.status_code == status.HTTP_201_CREATED, response.data
        assert Issue.objects.get(pk=response.data["id"]).type_id == ctx.bug.id

    def test_a_type_of_another_workspace_is_rejected(self, ctx, mock_celery):
        response = ctx.client.post(ctx.issues_url, {"name": "Inject", "type_id": str(ctx.foreign.id)}, format="json")
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "type_id" in response.data
        assert not Issue.objects.filter(name="Inject").exists()

    def test_the_error_does_not_reveal_whether_the_type_exists(self, ctx, mock_celery):
        foreign = ctx.client.post(ctx.issues_url, {"name": "A", "type_id": str(ctx.foreign.id)}, format="json")
        missing = ctx.client.post(ctx.issues_url, {"name": "B", "type_id": str(uuid4())}, format="json")
        assert foreign.status_code == missing.status_code == status.HTTP_400_BAD_REQUEST
        assert foreign.data == missing.data

    def test_a_type_not_enabled_in_the_project_is_rejected(self, ctx, mock_celery):
        response = ctx.client.post(ctx.issues_url, {"name": "Story", "type_id": str(ctx.not_enabled.id)}, format="json")
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_an_inactive_type_is_rejected(self, ctx, mock_celery):
        IssueType.objects.filter(pk=ctx.bug.pk).update(is_active=False)
        response = ctx.client.post(ctx.issues_url, {"name": "Bug", "type_id": str(ctx.bug.id)}, format="json")
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    @pytest.mark.parametrize("bad", ["not-a-uuid", 42, ["x"], {"id": "x"}])
    def test_a_malformed_type_id_is_a_400(self, ctx, mock_celery, bad):
        response = ctx.client.post(ctx.issues_url, {"name": "Bad", "type_id": bad}, format="json")
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "valid UUID" in str(response.data["type_id"][0])

    def test_the_integer_form_of_an_enabled_type_is_rejected(self, ctx, mock_celery):
        response = ctx.client.post(ctx.issues_url, {"name": "Int", "type_id": ctx.bug.id.int}, format="json")
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "valid UUID" in str(response.data["type_id"][0])
        assert not Issue.objects.filter(name="Int").exists()

    def test_the_model_field_name_cannot_bypass_the_check(self, ctx, mock_celery):
        response = ctx.client.post(ctx.issues_url, {"name": "Sneaky", "type": str(ctx.foreign.id)}, format="json")
        assert response.status_code == status.HTTP_201_CREATED, response.data
        assert Issue.objects.get(pk=response.data["id"]).type_id == ctx.default_type.id


@pytest.mark.contract
@pytest.mark.django_db
class TestUpdateWorkItemType:
    def test_changing_to_an_enabled_type(self, ctx, mock_celery):
        issue = Issue.objects.create(name="Item", project=ctx.project)
        response = ctx.client.patch(_issue_url(ctx, issue), {"type_id": str(ctx.bug.id)}, format="json")
        assert response.status_code == status.HTTP_204_NO_CONTENT, response.data
        issue.refresh_from_db()
        assert issue.type_id == ctx.bug.id

    def test_changing_to_a_type_of_another_workspace_is_rejected(self, ctx, mock_celery):
        issue = Issue.objects.create(name="Item", project=ctx.project)
        response = ctx.client.patch(_issue_url(ctx, issue), {"type_id": str(ctx.foreign.id)}, format="json")
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        issue.refresh_from_db()
        assert issue.type_id == ctx.default_type.id

    def test_changing_to_the_integer_form_of_an_enabled_type_is_rejected(self, ctx, mock_celery):
        issue = Issue.objects.create(name="Item", project=ctx.project)
        response = ctx.client.patch(_issue_url(ctx, issue), {"type_id": ctx.bug.id.int}, format="json")
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        issue.refresh_from_db()
        assert issue.type_id == ctx.default_type.id

    def test_a_null_type_is_rejected_on_update(self, ctx, mock_celery):
        issue = Issue.objects.create(name="Item", project=ctx.project, type=ctx.bug)
        response = ctx.client.patch(_issue_url(ctx, issue), {"type_id": None}, format="json")
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "type_id" in response.data
        issue.refresh_from_db()
        assert issue.type_id == ctx.bug.id

    def test_a_work_item_keeps_its_type_once_deactivated(self, ctx, mock_celery):
        issue = Issue.objects.create(name="Item", project=ctx.project, type=ctx.bug)
        IssueType.objects.filter(pk=ctx.bug.pk).update(is_active=False)
        response = ctx.client.patch(
            _issue_url(ctx, issue), {"name": "Renamed", "type_id": str(ctx.bug.id)}, format="json"
        )
        assert response.status_code == status.HTTP_204_NO_CONTENT, response.data
        issue.refresh_from_db()
        assert issue.type_id == ctx.bug.id and issue.name == "Renamed"


@pytest.mark.contract
@pytest.mark.django_db
class TestWorkItemTypeInResponses:
    def test_detail_returns_type_id(self, ctx):
        issue = Issue.objects.create(name="Item", project=ctx.project, type=ctx.bug)
        response = ctx.client.get(_issue_url(ctx, issue))
        assert response.status_code == status.HTTP_200_OK, response.data
        assert str(response.data["type_id"]) == str(ctx.bug.id)

    def test_list_returns_type_id(self, ctx):
        issue = Issue.objects.create(name="Item", project=ctx.project, type=ctx.bug)
        response = ctx.client.get(ctx.issues_url)
        assert response.status_code == status.HTTP_200_OK, response.data
        rows = {str(row["id"]): row for row in response.data["results"]}
        assert str(rows[str(issue.id)]["type_id"]) == str(ctx.bug.id)

    def test_sub_issues_return_type_id(self, ctx):
        parent = Issue.objects.create(name="Parent", project=ctx.project)
        child = Issue.objects.create(name="Child", project=ctx.project, parent=parent, type=ctx.bug)
        response = ctx.client.get(f"{_issue_url(ctx, parent)}sub-issues/")
        assert response.status_code == status.HTTP_200_OK, response.data
        rows = {str(row["id"]): row for row in response.data["sub_issues"]}
        assert str(rows[str(child.id)]["type_id"]) == str(ctx.bug.id)


@pytest.mark.contract
@pytest.mark.django_db
class TestDraftWorkItemType:
    def test_a_draft_rejects_a_type_of_another_workspace(self, ctx):
        response = ctx.client.post(
            DRAFTS_URL.format(slug=ctx.workspace.slug),
            {"name": "Draft", "project_id": str(ctx.project.id), "type_id": str(ctx.foreign.id)},
            format="json",
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert not DraftIssue.objects.filter(name="Draft").exists()

    def test_a_draft_rejects_the_integer_form_of_an_enabled_type(self, ctx):
        response = ctx.client.post(
            DRAFTS_URL.format(slug=ctx.workspace.slug),
            {"name": "Int draft", "project_id": str(ctx.project.id), "type_id": ctx.bug.id.int},
            format="json",
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert not DraftIssue.objects.filter(name="Int draft").exists()

    def test_a_draft_keeps_an_enabled_type(self, ctx):
        response = ctx.client.post(
            DRAFTS_URL.format(slug=ctx.workspace.slug),
            {"name": "Draft", "project_id": str(ctx.project.id), "type_id": str(ctx.bug.id)},
            format="json",
        )
        assert response.status_code == status.HTTP_201_CREATED, response.data
        assert str(response.data["type_id"]) == str(ctx.bug.id)

    def test_a_draft_without_project_accepts_only_an_active_workspace_type(self, ctx):
        accepted = ctx.client.post(
            DRAFTS_URL.format(slug=ctx.workspace.slug),
            {"name": "Loose", "type_id": str(ctx.not_enabled.id)},
            format="json",
        )
        rejected = ctx.client.post(
            DRAFTS_URL.format(slug=ctx.workspace.slug),
            {"name": "Loose foreign", "type_id": str(ctx.foreign.id)},
            format="json",
        )
        assert accepted.status_code == status.HTTP_201_CREATED, accepted.data
        assert rejected.status_code == status.HTTP_400_BAD_REQUEST

    def test_a_draft_update_rejects_a_type_of_another_workspace(self, ctx):
        draft = DraftIssue(name="Draft", project=ctx.project, workspace=ctx.workspace)
        draft.save(created_by_id=ctx.user.id)
        response = ctx.client.patch(
            f"{DRAFTS_URL.format(slug=ctx.workspace.slug)}{draft.id}/",
            {"type_id": str(ctx.foreign.id)},
            format="json",
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        draft.refresh_from_db()
        assert draft.type_id != ctx.foreign.id


@pytest.mark.contract
@pytest.mark.django_db
class TestDraftConversionWorkItemType:
    """Converting a draft is a creation (spec 6.3): its stored type gets no "keep current" exemption."""

    @pytest.fixture(autouse=True)
    def _no_side_effects(self, mock_celery):
        with mock.patch("plane.app.views.workspace.draft.base_host", return_value="http://testserver"):
            yield

    def _convert(self, ctx, draft, type_id):
        return ctx.client.post(
            f"/api/workspaces/{ctx.workspace.slug}/draft-to-issue/{draft.id}/",
            {"name": draft.name, "type_id": str(type_id)},
            format="json",
        )

    def _stale_draft(self, ctx, name):
        draft = DraftIssue(name=name, project=ctx.project, workspace=ctx.workspace, type=ctx.bug)
        draft.save(created_by_id=ctx.user.id)
        return draft

    @pytest.mark.parametrize("staleness", ["deactivated", "disabled_in_project"])
    def test_a_stale_type_is_refused_and_the_project_default_is_accepted(self, ctx, staleness):
        draft = self._stale_draft(ctx, f"Stale {staleness}")
        if staleness == "deactivated":
            IssueType.objects.filter(pk=ctx.bug.pk).update(is_active=False)
        else:
            ProjectIssueType.objects.filter(project=ctx.project, issue_type=ctx.bug).delete()

        refused = self._convert(ctx, draft, ctx.bug.id)
        assert refused.status_code == status.HTTP_400_BAD_REQUEST
        assert refused.data == {"type_id": ["Work item type is not valid for this project."]}
        assert DraftIssue.objects.filter(pk=draft.pk).exists()

        accepted = self._convert(ctx, draft, ctx.default_type.id)
        assert accepted.status_code == status.HTTP_201_CREATED, accepted.data
        assert Issue.objects.get(pk=accepted.data["id"]).type_id == ctx.default_type.id


@pytest.mark.contract
@pytest.mark.django_db
class TestIntakeWorkItemType:
    def test_an_intake_work_item_rejects_a_type_of_another_workspace(self, ctx, mock_celery):
        ctx.project.intake_view = True
        ctx.project.save()
        Intake.objects.create(name="Intake", project=ctx.project, is_default=True)
        response = ctx.client.post(
            INTAKE_URL.format(slug=ctx.workspace.slug, project_id=ctx.project.id),
            {"issue": {"name": "Inject", "type_id": str(ctx.foreign.id)}},
            format="json",
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert not Issue.objects.filter(name="Inject").exists()
