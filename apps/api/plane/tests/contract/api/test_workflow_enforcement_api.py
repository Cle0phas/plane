# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import json
from types import SimpleNamespace
from unittest import mock

import pytest
from rest_framework import status
from rest_framework.test import APIRequestFactory, force_authenticate

from plane.api.views.issue import IssueDetailAPIEndpoint
from plane.db.models import Issue, Project, ProjectMember, WorkflowTransitionRule
from plane.tests.factories import IssueTypeFactory, ProjectIssueTypeFactory
from plane.tests.workflow_builders import build_workflow, link_project

ISSUES_URL = "/api/v1/workspaces/{slug}/projects/{project_id}/work-items/"
ISSUE_URL = "/api/v1/workspaces/{slug}/projects/{project_id}/work-items/{issue_id}/"
REFUSED = {"workflow": ["transition_not_allowed"]}


@pytest.fixture
def ctx(db, workspace, create_user):
    project = Project.objects.create(name="Home", identifier="HOME", workspace=workspace, created_by=create_user)
    ProjectMember.objects.create(project=project, member=create_user, role=20, is_active=True)
    software = build_workflow(
        workspace,
        "Software",
        ["To do", "Doing", "Done"],
        [(["To do"], "Doing", None), (["Doing"], "Done", {"roles": [15]})],
    )
    support = build_workflow(workspace, "Support", ["New", "Doing", "Closed"], [(["New"], "Closed", None)])
    bug = IssueTypeFactory(workspace=workspace, name="Bug")
    ProjectIssueTypeFactory(project=project, issue_type=bug)
    return SimpleNamespace(
        workspace=workspace,
        project=project,
        user=create_user,
        bug=bug,
        states=link_project(project, software, {bug: support}),
        issues_url=ISSUES_URL.format(slug=workspace.slug, project_id=project.id),
    )


@pytest.fixture
def dispatched(mock_celery):
    """Work item activity dispatches of the v1 views (the API key middleware has its own tasks)."""
    with (
        mock.patch("plane.api.views.issue.issue_activity") as activity,
        mock.patch("plane.api.views.issue.model_activity") as model,
    ):
        yield SimpleNamespace(activity=activity.delay, model=model.delay)


def _url(ctx, issue):
    return ISSUE_URL.format(slug=ctx.workspace.slug, project_id=ctx.project.id, issue_id=issue.id)


@pytest.mark.contract
@pytest.mark.django_db
class TestApiV1Workflow:
    def test_creation_takes_the_initial_state(self, api_key_client, ctx, mock_celery):
        response = api_key_client.post(ctx.issues_url, {"name": "Plain"}, format="json")
        assert response.status_code == status.HTTP_201_CREATED, response.data
        assert Issue.objects.get(pk=response.data["id"]).state_id == ctx.states["To do"].id

    def test_creation_in_another_state_is_refused(self, api_key_client, ctx, dispatched):
        response = api_key_client.post(
            ctx.issues_url, {"name": "Skip", "state": str(ctx.states["Done"].id)}, format="json"
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert response.data == REFUSED
        assert not Issue.objects.filter(name="Skip").exists()
        assert dispatched.activity.call_count == dispatched.model.call_count == 0

    def test_patch_follows_the_arrows(self, api_key_client, ctx, dispatched):
        issue = Issue.objects.create(name="Item", project=ctx.project, state=ctx.states["To do"])
        refused = api_key_client.patch(_url(ctx, issue), {"state": str(ctx.states["Done"].id)}, format="json")
        allowed = api_key_client.patch(_url(ctx, issue), {"state": str(ctx.states["Doing"].id)}, format="json")
        assert refused.status_code == status.HTTP_400_BAD_REQUEST
        assert refused.data == REFUSED
        assert dispatched.activity.call_count == 1  # the allowed call only
        assert allowed.status_code == status.HTTP_200_OK, allowed.data

    def test_the_rule_is_checked_against_the_key_owner(self, api_key_client, ctx, dispatched):
        issue = Issue.objects.create(name="Item", project=ctx.project, state=ctx.states["Doing"])
        # The key owner is a project admin (20) and the rule admits members (15) only.
        refused = api_key_client.patch(_url(ctx, issue), {"state": str(ctx.states["Done"].id)}, format="json")
        assert refused.status_code == status.HTTP_400_BAD_REQUEST
        issue.refresh_from_db()
        assert issue.state_id == ctx.states["Doing"].id
        assert dispatched.activity.call_count == dispatched.model.call_count == 0
        WorkflowTransitionRule.objects.update(params={"user_ids": [str(ctx.user.id)]})
        allowed = api_key_client.patch(_url(ctx, issue), {"state": str(ctx.states["Done"].id)}, format="json")
        assert allowed.status_code == status.HTTP_200_OK, allowed.data

    def test_the_upsert_update_branch_is_controlled(self, ctx, dispatched):
        issue = Issue.objects.create(
            name="Item", project=ctx.project, state=ctx.states["To do"], external_id="e1", external_source="src"
        )
        # No URL routes the upsert PUT, so the view is called directly.
        request = APIRequestFactory().put(
            ctx.issues_url,
            {"name": "Item", "external_id": "e1", "external_source": "src", "state": str(ctx.states["Done"].id)},
            format="json",
        )
        force_authenticate(request, user=ctx.user)
        response = IssueDetailAPIEndpoint.as_view()(request, slug=ctx.workspace.slug, project_id=ctx.project.id)
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert response.data == REFUSED
        issue.refresh_from_db()
        assert issue.state_id == ctx.states["To do"].id
        assert dispatched.activity.call_count == dispatched.model.call_count == 0

    def test_a_type_change_to_another_workflow_sets_the_initial_state(self, api_key_client, ctx, dispatched):
        issue = Issue.objects.create(name="Item", project=ctx.project, state=ctx.states["To do"])
        before_type = issue.type_id
        refused = api_key_client.patch(
            _url(ctx, issue), {"type_id": str(ctx.bug.id), "state": str(ctx.states["Closed"].id)}, format="json"
        )
        assert refused.status_code == status.HTTP_400_BAD_REQUEST
        assert refused.data == REFUSED
        issue.refresh_from_db()
        assert (issue.type_id, issue.state_id) == (before_type, ctx.states["To do"].id)
        assert dispatched.activity.call_count == 0
        allowed = api_key_client.patch(_url(ctx, issue), {"type_id": str(ctx.bug.id)}, format="json")
        assert allowed.status_code == status.HTTP_200_OK, allowed.data
        requested = json.loads(dispatched.activity.call_args.kwargs["requested_data"])
        assert requested["state_id"] == str(ctx.states["New"].id)
        issue.refresh_from_db()
        assert (issue.type_id, issue.state_id) == (ctx.bug.id, ctx.states["New"].id)
