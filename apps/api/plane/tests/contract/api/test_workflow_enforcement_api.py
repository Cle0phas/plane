# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from types import SimpleNamespace

import pytest
from rest_framework import status

from plane.db.models import Issue, Project, ProjectMember, WorkflowTransitionRule
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
    return SimpleNamespace(
        workspace=workspace,
        project=project,
        user=create_user,
        states=link_project(project, software),
        issues_url=ISSUES_URL.format(slug=workspace.slug, project_id=project.id),
    )


def _url(ctx, issue):
    return ISSUE_URL.format(slug=ctx.workspace.slug, project_id=ctx.project.id, issue_id=issue.id)


@pytest.mark.contract
@pytest.mark.django_db
class TestApiV1Workflow:
    def test_creation_takes_the_initial_state(self, api_key_client, ctx, mock_celery):
        response = api_key_client.post(ctx.issues_url, {"name": "Plain"}, format="json")
        assert response.status_code == status.HTTP_201_CREATED, response.data
        assert Issue.objects.get(pk=response.data["id"]).state_id == ctx.states["To do"].id

    def test_creation_in_another_state_is_refused(self, api_key_client, ctx, mock_celery):
        response = api_key_client.post(
            ctx.issues_url, {"name": "Skip", "state": str(ctx.states["Done"].id)}, format="json"
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert response.data == REFUSED

    def test_patch_follows_the_arrows(self, api_key_client, ctx, mock_celery):
        issue = Issue.objects.create(name="Item", project=ctx.project, state=ctx.states["To do"])
        refused = api_key_client.patch(_url(ctx, issue), {"state": str(ctx.states["Done"].id)}, format="json")
        allowed = api_key_client.patch(_url(ctx, issue), {"state": str(ctx.states["Doing"].id)}, format="json")
        assert refused.status_code == status.HTTP_400_BAD_REQUEST
        assert refused.data == REFUSED
        assert allowed.status_code == status.HTTP_200_OK, allowed.data

    def test_the_rule_is_checked_against_the_key_owner(self, api_key_client, ctx, mock_celery):
        issue = Issue.objects.create(name="Item", project=ctx.project, state=ctx.states["Doing"])
        # The key owner is a project admin (20) and the rule admits members (15) only.
        refused = api_key_client.patch(_url(ctx, issue), {"state": str(ctx.states["Done"].id)}, format="json")
        assert refused.status_code == status.HTTP_400_BAD_REQUEST
        WorkflowTransitionRule.objects.update(params={"user_ids": [str(ctx.user.id)]})
        allowed = api_key_client.patch(_url(ctx, issue), {"state": str(ctx.states["Done"].id)}, format="json")
        assert allowed.status_code == status.HTTP_200_OK, allowed.data
