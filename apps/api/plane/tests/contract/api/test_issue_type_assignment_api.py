# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""R9 on the public API v1: regression for the cross-workspace type injection."""

from types import SimpleNamespace
from uuid import uuid4

import pytest
from rest_framework import status

from plane.db.models import Issue, IssueType, Project, ProjectIssueType, ProjectMember
from plane.tests.factories import IssueTypeFactory, WorkspaceFactory

ISSUES_URL = "/api/v1/workspaces/{slug}/projects/{project_id}/work-items/"
ISSUE_URL = "/api/v1/workspaces/{slug}/projects/{project_id}/work-items/{issue_id}/"


@pytest.fixture
def ctx(db, workspace, create_user):
    project = Project.objects.create(name="Home", identifier="HOME", workspace=workspace, created_by=create_user)
    ProjectMember.objects.create(project=project, member=create_user, role=20, is_active=True)
    bug = IssueTypeFactory(workspace=workspace, name="Bug")
    ProjectIssueType.objects.create(project=project, issue_type=bug)
    return SimpleNamespace(
        workspace=workspace,
        project=project,
        default_type=IssueType.objects.get(workspace=workspace, is_default=True),
        bug=bug,
        not_enabled=IssueTypeFactory(workspace=workspace, name="Story"),
        foreign=IssueTypeFactory(workspace=WorkspaceFactory(), name="Foreign"),
        issues_url=ISSUES_URL.format(slug=workspace.slug, project_id=project.id),
    )


@pytest.mark.contract
@pytest.mark.django_db
class TestApiV1WorkItemType:
    def test_without_type_the_project_default_is_used(self, api_key_client, ctx, mock_celery):
        response = api_key_client.post(ctx.issues_url, {"name": "Plain"}, format="json")
        assert response.status_code == status.HTTP_201_CREATED, response.data
        assert Issue.objects.get(pk=response.data["id"]).type_id == ctx.default_type.id
        assert response.data["type_id"] == str(ctx.default_type.id)

    def test_a_type_of_another_workspace_is_rejected(self, api_key_client, ctx, mock_celery):
        response = api_key_client.post(
            ctx.issues_url, {"name": "Inject", "type_id": str(ctx.foreign.id)}, format="json"
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert not Issue.objects.filter(name="Inject").exists()

    def test_the_error_does_not_reveal_whether_the_type_exists(self, api_key_client, ctx, mock_celery):
        foreign = api_key_client.post(ctx.issues_url, {"name": "A", "type_id": str(ctx.foreign.id)}, format="json")
        missing = api_key_client.post(ctx.issues_url, {"name": "B", "type_id": str(uuid4())}, format="json")
        assert foreign.status_code == missing.status_code == status.HTTP_400_BAD_REQUEST
        assert foreign.data == missing.data

    def test_a_type_not_enabled_in_the_project_is_rejected(self, api_key_client, ctx, mock_celery):
        response = api_key_client.post(
            ctx.issues_url, {"name": "Story", "type_id": str(ctx.not_enabled.id)}, format="json"
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    @pytest.mark.parametrize("bad", ["not-a-uuid", 42, ["x"]])
    def test_a_malformed_type_id_is_a_400(self, api_key_client, ctx, mock_celery, bad):
        response = api_key_client.post(ctx.issues_url, {"name": "Bad", "type_id": bad}, format="json")
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "valid UUID" in str(response.data["type_id"][0])

    def test_the_integer_form_of_an_enabled_type_is_rejected(self, api_key_client, ctx, mock_celery):
        response = api_key_client.post(ctx.issues_url, {"name": "Int", "type_id": ctx.bug.id.int}, format="json")
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert not Issue.objects.filter(name="Int").exists()
        issue = Issue.objects.create(name="Item", project=ctx.project)
        url = ISSUE_URL.format(slug=ctx.workspace.slug, project_id=ctx.project.id, issue_id=issue.id)
        response = api_key_client.patch(url, {"type_id": ctx.bug.id.int}, format="json")
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        issue.refresh_from_db()
        assert issue.type_id == ctx.default_type.id

    def test_an_inactive_type_is_rejected(self, api_key_client, ctx, mock_celery):
        IssueType.objects.filter(pk=ctx.bug.pk).update(is_active=False)
        response = api_key_client.post(ctx.issues_url, {"name": "Bug", "type_id": str(ctx.bug.id)}, format="json")
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_the_model_field_name_cannot_bypass_the_check(self, api_key_client, ctx, mock_celery):
        response = api_key_client.post(ctx.issues_url, {"name": "Sneaky", "type": str(ctx.foreign.id)}, format="json")
        assert response.status_code == status.HTTP_201_CREATED, response.data
        assert Issue.objects.get(pk=response.data["id"]).type_id == ctx.default_type.id

    def test_update_to_an_enabled_type(self, api_key_client, ctx, mock_celery):
        issue = Issue.objects.create(name="Item", project=ctx.project)
        url = ISSUE_URL.format(slug=ctx.workspace.slug, project_id=ctx.project.id, issue_id=issue.id)
        response = api_key_client.patch(url, {"type_id": str(ctx.bug.id)}, format="json")
        assert response.status_code == status.HTTP_200_OK, response.data
        issue.refresh_from_db()
        assert issue.type_id == ctx.bug.id

    def test_update_to_a_type_of_another_workspace_is_rejected(self, api_key_client, ctx, mock_celery):
        issue = Issue.objects.create(name="Item", project=ctx.project)
        url = ISSUE_URL.format(slug=ctx.workspace.slug, project_id=ctx.project.id, issue_id=issue.id)
        response = api_key_client.patch(url, {"type_id": str(ctx.foreign.id)}, format="json")
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        issue.refresh_from_db()
        assert issue.type_id == ctx.default_type.id

    def test_a_null_type_is_rejected_on_update(self, api_key_client, ctx, mock_celery):
        issue = Issue.objects.create(name="Item", project=ctx.project, type=ctx.bug)
        url = ISSUE_URL.format(slug=ctx.workspace.slug, project_id=ctx.project.id, issue_id=issue.id)
        response = api_key_client.patch(url, {"type_id": None}, format="json")
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        issue.refresh_from_db()
        assert issue.type_id == ctx.bug.id

    def test_a_null_type_at_creation_means_the_project_default(self, api_key_client, ctx, mock_celery):
        response = api_key_client.post(ctx.issues_url, {"name": "Null", "type_id": None}, format="json")
        assert response.status_code == status.HTTP_201_CREATED, response.data
        assert Issue.objects.get(pk=response.data["id"]).type_id == ctx.default_type.id
