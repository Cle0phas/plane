# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from uuid import uuid4

import pytest
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from plane.db.models import (
    AuditLog,
    Issue,
    Project,
    ProjectMember,
    ProjectWorkflowScheme,
    State,
    WorkspaceMember,
)
from plane.tests.factories import (
    IssueTypeFactory,
    ProjectFactory,
    ProjectIssueTypeFactory,
    UserFactory,
    WorkspaceFactory,
)
from plane.tests.workflow_builders import build_workflow, link_project

SCHEME_URL = "/api/workspaces/{slug}/projects/{project_id}/workflow-scheme/"
PREVIEW_URL = "/api/workspaces/{slug}/projects/{project_id}/workflow-scheme/preview/"


def _client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def users(db, workspace, create_user):
    people = {"admin": create_user}
    for name, role in (("member", 15), ("guest", 5), ("project_admin", 15), ("outside_admin", 20)):
        people[name] = UserFactory()
        WorkspaceMember.objects.create(workspace=workspace, member=people[name], role=role)
    return people


@pytest.fixture
def project(workspace, users):
    project = Project.objects.create(name="Home", identifier="HOME", workspace=workspace, created_by=users["admin"])
    for name, role in (("admin", 20), ("member", 15), ("guest", 5), ("project_admin", 20)):
        ProjectMember.objects.create(project=project, member=users[name], role=role)
    return project


@pytest.fixture
def software(workspace):
    return build_workflow(workspace, "Software", ["To do", "Done"], [(["To do"], "Done", None)])


@pytest.fixture
def support(workspace):
    return build_workflow(workspace, "Support", ["New", "Closed"], [(["New"], "Closed", None)])


@pytest.fixture
def bug(workspace, project):
    bug = IssueTypeFactory(workspace=workspace, name="Bug")
    ProjectIssueTypeFactory(project=project, issue_type=bug)
    return bug


def _url(template, workspace, project):
    return template.format(slug=workspace.slug, project_id=project.id)


@pytest.mark.contract
@pytest.mark.django_db
class TestRead:
    @pytest.mark.parametrize("role", ["admin", "member", "guest", "outside_admin"])
    def test_every_workspace_member_reads_the_scheme(self, workspace, users, project, software, bug, support, role):
        link_project(project, software, {bug: support})
        response = _client(users[role]).get(_url(SCHEME_URL, workspace, project))
        assert response.status_code == status.HTTP_200_OK
        assert response.data["default_workflow_id"] == str(software.id)
        assert response.data["items"] == [{"issue_type_id": str(bug.id), "workflow_id": str(support.id)}]
        assert sorted(workflow["name"] for workflow in response.data["workflows"]) == ["Software", "Support"]

    def test_a_free_project_has_an_empty_scheme(self, workspace, users, project):
        response = _client(users["member"]).get(_url(SCHEME_URL, workspace, project))
        assert response.data == {"default_workflow_id": None, "items": [], "workflows": []}

    def test_non_member_is_refused_and_foreign_projects_look_missing(self, workspace, users, project):
        assert _client(UserFactory()).get(_url(SCHEME_URL, workspace, project)).status_code == status.HTTP_403_FORBIDDEN
        foreign = ProjectFactory(workspace=WorkspaceFactory())
        client = _client(users["admin"])
        hidden = client.get(SCHEME_URL.format(slug=workspace.slug, project_id=foreign.id))
        missing = client.get(SCHEME_URL.format(slug=workspace.slug, project_id=uuid4()))
        assert hidden.status_code == missing.status_code == status.HTTP_404_NOT_FOUND
        assert hidden.data == missing.data


@pytest.mark.contract
@pytest.mark.django_db
class TestWrite:
    @pytest.mark.parametrize("role", ["member", "guest"])
    def test_non_managers_cannot_write(self, workspace, users, project, software, role):
        client = _client(users[role])
        body = {"default_workflow_id": str(software.id), "items": []}
        responses = [
            client.put(_url(SCHEME_URL, workspace, project), body, format="json"),
            client.post(_url(PREVIEW_URL, workspace, project), body, format="json"),
            client.delete(_url(SCHEME_URL, workspace, project)),
        ]
        assert {response.status_code for response in responses} == {status.HTTP_403_FORBIDDEN}
        assert not ProjectWorkflowScheme.objects.exists()

    @pytest.mark.parametrize("role", ["admin", "project_admin", "outside_admin"])
    def test_project_or_workspace_admins_link_a_project(self, workspace, users, project, software, role, mock_celery):
        response = _client(users[role]).put(
            _url(SCHEME_URL, workspace, project), {"default_workflow_id": str(software.id), "items": []}, format="json"
        )
        assert response.status_code == status.HTTP_200_OK, response.data
        assert set(State.objects.filter(project=project).values_list("name", flat=True)) == {"To do", "Done"}
        entry = AuditLog.objects.get(action="project_workflow_scheme.applied")
        assert entry.actor_id == users[role].id

    def test_preview_then_apply_with_a_mapping(self, workspace, users, project, software, mock_celery):
        legacy = State.objects.create(name="Backlog", project=project)
        issue = Issue.objects.create(name="Item", project=project, state=legacy)
        client = _client(users["admin"])
        body = {"default_workflow_id": str(software.id), "items": []}

        preview = client.post(_url(PREVIEW_URL, workspace, project), body, format="json")
        assert preview.status_code == status.HTTP_200_OK
        assert [(need["state_name"], need["issue_count"]) for need in preview.data["needs"]] == [("Backlog", 1)]

        refused = client.put(_url(SCHEME_URL, workspace, project), body, format="json")
        assert refused.status_code == status.HTTP_400_BAD_REQUEST
        assert refused.data["scheme"] == ["mapping_incomplete"]
        assert refused.data["needs"][0]["state_id"] == str(legacy.id)

        done = software.states_by_name["Done"].status_id
        body["mappings"] = [{"state_id": str(legacy.id), "workflow_id": str(software.id), "status_id": str(done)}]
        applied = client.put(_url(SCHEME_URL, workspace, project), body, format="json")
        assert applied.status_code == status.HTTP_200_OK, applied.data
        issue.refresh_from_db()
        assert issue.state.workflow_status_id == done

    def test_invalid_schemes_are_refused(self, workspace, users, project, software, bug):
        foreign = build_workflow(WorkspaceFactory(), "Foreign", ["A"])
        stranger = IssueTypeFactory(workspace=workspace, name="Stranger")
        client = _client(users["admin"])
        bodies = [
            {"default_workflow_id": str(foreign.id), "items": []},
            {
                "default_workflow_id": str(software.id),
                "items": [{"issue_type_id": str(stranger.id), "workflow_id": str(software.id)}],
            },
        ]
        for body in bodies:
            response = client.put(_url(SCHEME_URL, workspace, project), body, format="json")
            assert response.status_code == status.HTTP_400_BAD_REQUEST
            assert response.data == {"scheme": ["invalid_scheme"]}

    def test_a_type_listed_twice_is_refused(self, workspace, users, project, software, bug):
        line = {"issue_type_id": str(bug.id), "workflow_id": str(software.id)}
        response = _client(users["admin"]).put(
            _url(SCHEME_URL, workspace, project),
            {"default_workflow_id": str(software.id), "items": [line, line]},
            format="json",
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_detach(self, workspace, users, project, software):
        link_project(project, software)
        response = _client(users["project_admin"]).delete(_url(SCHEME_URL, workspace, project))
        assert response.status_code == status.HTTP_204_NO_CONTENT
        assert not ProjectWorkflowScheme.objects.exists()
        assert not State.objects.filter(project=project, workflow_status__isnull=False).exists()

    def test_an_archived_project_cannot_be_linked(self, workspace, users, project, software):
        Project.objects.filter(pk=project.pk).update(archived_at=timezone.now())
        response = _client(users["admin"]).put(
            _url(SCHEME_URL, workspace, project), {"default_workflow_id": str(software.id), "items": []}, format="json"
        )
        assert response.status_code == status.HTTP_404_NOT_FOUND
