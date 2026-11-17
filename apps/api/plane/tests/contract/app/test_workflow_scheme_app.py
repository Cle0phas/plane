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
    ProjectIssueType,
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
    roles = {"member": 15, "guest": 5, "project_admin": 15, "outside_admin": 20}
    roles.update(outside_member=15, outside_guest=5, former_member=15)
    for name, role in roles.items():
        people[name] = UserFactory()
        WorkspaceMember.objects.create(workspace=workspace, member=people[name], role=role)
    return people


@pytest.fixture
def project(workspace, users):
    project = Project.objects.create(name="Home", identifier="HOME", workspace=workspace, created_by=users["admin"])
    for name, role in (("admin", 20), ("member", 15), ("guest", 5), ("project_admin", 20)):
        ProjectMember.objects.create(project=project, member=users[name], role=role)
    ProjectMember.objects.create(project=project, member=users["former_member"], role=15, is_active=False)
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
    @pytest.mark.parametrize("role", ["admin", "member", "guest", "project_admin", "outside_admin"])
    def test_project_members_and_workspace_admins_read_the_scheme(
        self, workspace, users, project, software, bug, support, role
    ):
        link_project(project, software, {bug: support})
        response = _client(users[role]).get(_url(SCHEME_URL, workspace, project))
        assert response.status_code == status.HTTP_200_OK
        assert response.data["default_workflow_id"] == str(software.id)
        assert response.data["items"] == [{"issue_type_id": str(bug.id), "workflow_id": str(support.id)}]
        assert sorted(workflow["name"] for workflow in response.data["workflows"]) == ["Software", "Support"]

    @pytest.mark.parametrize("role", ["outside_member", "outside_guest", "former_member"])
    def test_outside_the_project_the_refusal_does_not_tell_whether_it_exists(
        self, workspace, users, project, software, role
    ):
        link_project(project, software)
        foreign = ProjectFactory(workspace=WorkspaceFactory())
        client = _client(users[role])
        refused = client.get(_url(SCHEME_URL, workspace, project))
        hidden = client.get(SCHEME_URL.format(slug=workspace.slug, project_id=foreign.id))
        missing = client.get(SCHEME_URL.format(slug=workspace.slug, project_id=uuid4()))
        assert refused.status_code == hidden.status_code == missing.status_code == status.HTTP_403_FORBIDDEN
        assert refused.data == hidden.data == missing.data
        assert "workflows" not in refused.data

    def test_other_workspaces_and_anonymous_callers_are_refused(self, workspace, project, software):
        link_project(project, software)
        stranger = UserFactory()
        WorkspaceMember.objects.create(workspace=WorkspaceFactory(), member=stranger, role=20)
        url = _url(SCHEME_URL, workspace, project)
        assert _client(stranger).get(url).status_code == status.HTTP_403_FORBIDDEN
        assert APIClient().get(url).status_code == status.HTTP_401_UNAUTHORIZED

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
        assert "items" in response.data

    def test_a_mapping_listed_twice_is_refused(self, workspace, users, project, software):
        line = {"state_id": str(uuid4()), "workflow_id": str(software.id), "status_id": str(uuid4())}
        response = _client(users["admin"]).put(
            _url(SCHEME_URL, workspace, project),
            {"default_workflow_id": str(software.id), "items": [], "mappings": [line, line]},
            format="json",
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "mappings" in response.data

    def test_an_arrival_status_outside_the_workflow_is_refused(self, workspace, users, project, software, support):
        legacy = State.objects.create(name="Backlog", project=project)
        Issue.objects.create(name="Item", project=project, state=legacy)
        foreign_status = support.states_by_name["Closed"].status_id
        body = {
            "default_workflow_id": str(software.id),
            "items": [],
            "mappings": [
                {"state_id": str(legacy.id), "workflow_id": str(software.id), "status_id": str(foreign_status)}
            ],
        }
        response = _client(users["admin"]).put(_url(SCHEME_URL, workspace, project), body, format="json")
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert response.data["scheme"] == ["invalid_mapping"]
        assert response.data["needs"][0]["state_id"] == str(legacy.id)

    @pytest.mark.parametrize("verb", ["put", "post", "delete"])
    def test_foreign_and_unknown_projects_look_the_same_on_writes(self, workspace, users, software, verb):
        foreign = ProjectFactory(workspace=WorkspaceFactory())
        client = _client(users["admin"])
        body = {"default_workflow_id": str(software.id), "items": []}
        url = PREVIEW_URL if verb == "post" else SCHEME_URL
        args = () if verb == "delete" else (body,)
        kwargs = {} if verb == "delete" else {"format": "json"}
        hidden = getattr(client, verb)(url.format(slug=workspace.slug, project_id=foreign.id), *args, **kwargs)
        missing = getattr(client, verb)(url.format(slug=workspace.slug, project_id=uuid4()), *args, **kwargs)
        assert hidden.status_code == missing.status_code == status.HTTP_404_NOT_FOUND
        assert hidden.data == missing.data

    def test_detach(self, workspace, users, project, software):
        link_project(project, software)
        response = _client(users["project_admin"]).delete(_url(SCHEME_URL, workspace, project))
        assert response.status_code == status.HTTP_204_NO_CONTENT
        assert not ProjectWorkflowScheme.objects.exists()
        assert not State.objects.filter(project=project, workflow_status__isnull=False).exists()
        assert AuditLog.objects.filter(
            action="project_workflow_scheme.detached", actor_id=users["project_admin"].id
        ).exists()

    def test_an_archived_project_cannot_be_linked(self, workspace, users, project, software):
        Project.objects.filter(pk=project.pk).update(archived_at=timezone.now())
        response = _client(users["admin"]).put(
            _url(SCHEME_URL, workspace, project), {"default_workflow_id": str(software.id), "items": []}, format="json"
        )
        assert response.status_code == status.HTTP_404_NOT_FOUND


PROJECT_TYPE_URL = "/api/workspaces/{slug}/projects/{project_id}/issue-types/{type_id}/"
WORKSPACE_TYPE_URL = "/api/workspaces/{slug}/issue-types/{type_id}/"
WORKFLOW_URL = "/api/workspaces/{slug}/workflows/{pk}/"


@pytest.mark.contract
@pytest.mark.django_db
class TestTypeRemoval:
    """A type leaving a project leaves its scheme too, so its workflow is no longer used there."""

    @pytest.fixture
    def other(self, workspace, users, bug):
        other = Project.objects.create(name="Other", identifier="OTH", workspace=workspace, created_by=users["admin"])
        ProjectMember.objects.create(project=other, member=users["admin"], role=20)
        ProjectIssueTypeFactory(project=other, issue_type=bug)
        return other

    def _workflow(self, client, workspace, workflow):
        return client.get(WORKFLOW_URL.format(slug=workspace.slug, pk=workflow.id))

    def test_removing_a_mapped_type_from_a_project_drops_its_line(
        self, workspace, users, project, software, support, bug, mock_celery
    ):
        link_project(project, software, {bug: support})
        client = _client(users["admin"])

        response = client.delete(PROJECT_TYPE_URL.format(slug=workspace.slug, project_id=project.id, type_id=bug.id))

        assert response.status_code == status.HTTP_204_NO_CONTENT, response.data
        scheme = client.get(_url(SCHEME_URL, workspace, project)).data
        assert scheme["default_workflow_id"] == str(software.id) and scheme["items"] == []
        assert set(State.objects.filter(project=project).values_list("name", flat=True)) == {"To do", "Done"}
        assert self._workflow(client, workspace, support).data["project_count"] == 0
        deleted = client.delete(WORKFLOW_URL.format(slug=workspace.slug, pk=support.id))
        assert deleted.status_code == status.HTTP_204_NO_CONTENT

    def test_deleting_a_mapped_workspace_type_drops_its_line_in_every_project(
        self, workspace, users, project, other, software, support, bug, mock_celery
    ):
        link_project(project, software, {bug: support})
        link_project(other, software, {bug: support})
        client = _client(users["admin"])

        response = client.delete(WORKSPACE_TYPE_URL.format(slug=workspace.slug, type_id=bug.id))

        assert response.status_code == status.HTTP_204_NO_CONTENT, response.data
        for linked in (project, other):
            assert client.get(_url(SCHEME_URL, workspace, linked)).data["items"] == []
            assert set(State.objects.filter(project=linked).values_list("name", flat=True)) == {"To do", "Done"}
        assert self._workflow(client, workspace, support).data["project_count"] == 0
        deleted = client.delete(WORKFLOW_URL.format(slug=workspace.slug, pk=support.id))
        assert deleted.status_code == status.HTTP_204_NO_CONTENT

    def test_a_project_without_a_scheme_is_unaffected(
        self, workspace, users, project, other, software, support, bug, mock_celery
    ):
        link_project(other, software, {bug: support})
        free = State.objects.create(name="Backlog", project=project)
        client = _client(users["admin"])

        removed = client.delete(PROJECT_TYPE_URL.format(slug=workspace.slug, project_id=project.id, type_id=bug.id))
        deleted = client.delete(WORKSPACE_TYPE_URL.format(slug=workspace.slug, type_id=bug.id))

        assert removed.status_code == deleted.status_code == status.HTTP_204_NO_CONTENT
        assert not ProjectWorkflowScheme.objects.filter(project=project).exists()
        assert list(State.objects.filter(project=project)) == [free]
        assert State.objects.get(pk=free.pk).workflow_status_id is None

    def test_the_audit_entries_of_the_removal_are_unchanged(
        self, workspace, users, project, software, support, bug, mock_celery
    ):
        link_project(project, software, {bug: support})
        seen = list(AuditLog.objects.values_list("id", flat=True))

        _client(users["admin"]).delete(
            PROJECT_TYPE_URL.format(slug=workspace.slug, project_id=project.id, type_id=bug.id)
        )

        added = AuditLog.objects.exclude(id__in=seen).values_list("action", flat=True)
        assert list(added) == ["project_issue_type.disabled"]

    @pytest.mark.parametrize("route", ["project", "workspace"])
    def test_a_removal_that_would_drop_a_state_holding_work_items_is_refused(
        self, workspace, users, project, software, support, bug, route, mock_celery
    ):
        states = link_project(project, software, {bug: support})
        # A work item of another type left in a state only the type's workflow brings (the model guard refuses it).
        stray = Issue.objects.create(name="Stray", project=project, state=states["To do"])
        Issue.objects.filter(pk=stray.pk).update(state=states["New"])
        seen = list(AuditLog.objects.values_list("id", flat=True))
        url = (
            PROJECT_TYPE_URL.format(slug=workspace.slug, project_id=project.id, type_id=bug.id)
            if route == "project"
            else WORKSPACE_TYPE_URL.format(slug=workspace.slug, type_id=bug.id)
        )

        response = _client(users["admin"]).delete(url)

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert isinstance(response.data["error"], str) and response.data["error"]
        assert ProjectWorkflowScheme.objects.get(project=project).items.filter(issue_type=bug).exists()
        assert ProjectIssueType.objects.filter(project=project, issue_type=bug).exists()
        assert State.objects.filter(pk=states["New"].pk).exists()
        assert not AuditLog.objects.exclude(id__in=seen).exists()
        mock_celery.assert_not_called()
