# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from uuid import uuid4

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from plane.db.models import AuditLog, Issue, IssueType, Project, ProjectIssueType, ProjectMember, WorkspaceMember
from plane.tests.factories import IssueTypeFactory, ProjectFactory, UserFactory, WorkspaceFactory

LIST_URL = "/api/workspaces/{slug}/projects/{project_id}/issue-types/"
DETAIL_URL = "/api/workspaces/{slug}/projects/{project_id}/issue-types/{issue_type_id}/"


def _client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def users(db, workspace, create_user):
    member = UserFactory()
    guest = UserFactory()
    project_admin = UserFactory()
    outside_admin = UserFactory()
    WorkspaceMember.objects.create(workspace=workspace, member=member, role=15)
    WorkspaceMember.objects.create(workspace=workspace, member=guest, role=5)
    WorkspaceMember.objects.create(workspace=workspace, member=project_admin, role=15)
    WorkspaceMember.objects.create(workspace=workspace, member=outside_admin, role=20)
    return {
        "admin": create_user,
        "member": member,
        "guest": guest,
        "project_admin": project_admin,
        "outside_admin": outside_admin,
    }


@pytest.fixture
def project(workspace, users):
    project = Project.objects.create(name="Home", identifier="HOME", workspace=workspace, created_by=users["admin"])
    ProjectMember.objects.create(project=project, member=users["admin"], role=20)
    ProjectMember.objects.create(project=project, member=users["member"], role=15)
    ProjectMember.objects.create(project=project, member=users["guest"], role=5)
    ProjectMember.objects.create(project=project, member=users["project_admin"], role=20)
    return project


@pytest.fixture
def default_type(workspace):
    return IssueType.objects.get(workspace=workspace, is_default=True)


@pytest.fixture
def bug(workspace):
    return IssueTypeFactory(workspace=workspace, name="Bug")


def _list_url(workspace, project):
    return LIST_URL.format(slug=workspace.slug, project_id=project.id)


def _detail_url(workspace, project, issue_type):
    return DETAIL_URL.format(slug=workspace.slug, project_id=project.id, issue_type_id=issue_type.id)


@pytest.mark.contract
@pytest.mark.django_db
class TestProjectIssueTypeRead:
    @pytest.mark.parametrize("role", ["admin", "member", "guest", "outside_admin"])
    def test_every_workspace_member_lists_the_project_types(self, workspace, users, project, default_type, role):
        Issue.objects.create(name="Item", project=project)

        response = _client(users[role]).get(_list_url(workspace, project))

        assert response.status_code == status.HTTP_200_OK, response.data
        assert len(response.data) == 1
        assert response.data[0]["issue_type_id"] == default_type.id
        assert response.data[0]["is_default"] is True
        assert response.data[0]["issue_count"] == 1

    def test_non_member_is_refused(self, workspace, project):
        assert _client(UserFactory()).get(_list_url(workspace, project)).status_code == status.HTTP_403_FORBIDDEN

    def test_a_project_of_another_workspace_looks_missing(self, workspace, users):
        foreign_project = ProjectFactory(workspace=WorkspaceFactory())
        client = _client(users["admin"])

        hidden = client.get(LIST_URL.format(slug=workspace.slug, project_id=foreign_project.id))
        missing = client.get(LIST_URL.format(slug=workspace.slug, project_id=uuid4()))

        assert hidden.status_code == missing.status_code == status.HTTP_404_NOT_FOUND
        assert hidden.data == missing.data

    def test_methods_are_not_mixed_between_the_list_and_detail_routes(self, workspace, users, project, bug):
        client = _client(users["admin"])

        assert client.get(_detail_url(workspace, project, bug)).status_code == status.HTTP_405_METHOD_NOT_ALLOWED
        assert client.patch(_list_url(workspace, project), {}, format="json").status_code == (
            status.HTTP_405_METHOD_NOT_ALLOWED
        )
        assert client.delete(_list_url(workspace, project)).status_code == status.HTTP_405_METHOD_NOT_ALLOWED
        assert client.post(_detail_url(workspace, project, bug), {}, format="json").status_code == (
            status.HTTP_405_METHOD_NOT_ALLOWED
        )


@pytest.mark.contract
@pytest.mark.django_db
class TestProjectIssueTypeWrite:
    @pytest.mark.parametrize("role", ["member", "guest"])
    def test_non_admins_cannot_change_project_types(
        self, workspace, users, project, default_type, bug, role, mock_celery
    ):
        ProjectIssueType.objects.create(project=project, issue_type=bug)
        client = _client(users[role])

        enabled = client.post(_list_url(workspace, project), {"issue_type_id": str(bug.id)}, format="json")
        defaulted = client.patch(_detail_url(workspace, project, bug), {"is_default": True}, format="json")
        removed = client.delete(_detail_url(workspace, project, bug))

        assert enabled.status_code == defaulted.status_code == removed.status_code == status.HTTP_403_FORBIDDEN
        assert ProjectIssueType.objects.get(project=project, is_default=True).issue_type_id == default_type.id
        assert ProjectIssueType.objects.filter(project=project, issue_type=bug).exists()
        assert not AuditLog.objects.exists()

    @pytest.mark.parametrize("role", ["admin", "project_admin", "outside_admin"])
    def test_project_or_workspace_admins_enable_a_type(self, workspace, users, project, bug, role):
        response = _client(users[role]).post(
            _list_url(workspace, project), {"issue_type_id": str(bug.id)}, format="json"
        )

        assert response.status_code == status.HTTP_201_CREATED, response.data
        link = ProjectIssueType.objects.get(project=project, issue_type=bug)
        assert response.data["is_default"] is False
        entry = AuditLog.objects.get(target_id=link.id)
        assert entry.action == "project_issue_type.enabled"
        assert entry.actor_id == users[role].id
        assert entry.after == {"project_id": str(project.id), "issue_type_id": str(bug.id), "is_default": False}

    def test_enabling_twice_keeps_a_single_link(self, workspace, users, project, bug):
        client = _client(users["admin"])
        url = _list_url(workspace, project)

        assert client.post(url, {"issue_type_id": str(bug.id)}, format="json").status_code == status.HTTP_201_CREATED
        assert client.post(url, {"issue_type_id": str(bug.id)}, format="json").status_code == status.HTTP_200_OK
        assert ProjectIssueType.objects.filter(project=project, issue_type=bug).count() == 1
        assert AuditLog.objects.filter(action="project_issue_type.enabled").count() == 1

    def test_an_inactive_type_cannot_be_enabled(self, workspace, users, project, bug):
        IssueType.objects.filter(pk=bug.pk).update(is_active=False)
        response = _client(users["admin"]).post(
            _list_url(workspace, project), {"issue_type_id": str(bug.id)}, format="json"
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert not ProjectIssueType.objects.filter(project=project, issue_type=bug).exists()

    def test_a_type_of_another_workspace_looks_missing(self, workspace, users, project):
        foreign = IssueTypeFactory(workspace=WorkspaceFactory(), name="Foreign")
        client = _client(users["admin"])

        hidden = client.post(_list_url(workspace, project), {"issue_type_id": str(foreign.id)}, format="json")
        missing = client.post(_list_url(workspace, project), {"issue_type_id": str(uuid4())}, format="json")

        assert hidden.status_code == missing.status_code == status.HTTP_404_NOT_FOUND
        assert hidden.data == missing.data
        assert not ProjectIssueType.objects.filter(issue_type=foreign).exists()

    @pytest.mark.parametrize(
        "payload",
        [{}, {"issue_type_id": "not-a-uuid"}, {"issue_type_id": None}, {"issue_type_id": 12}, {"issue_type_id": [1]}],
    )
    def test_a_missing_or_malformed_type_id_is_rejected(self, workspace, users, project, payload):
        response = _client(users["admin"]).post(_list_url(workspace, project), payload, format="json")
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    @pytest.mark.parametrize("payload", [[], ["x"], "text", 12, None])
    def test_a_non_object_body_is_rejected_not_a_server_error(self, workspace, users, project, bug, payload):
        ProjectIssueType.objects.create(project=project, issue_type=bug)
        client = _client(users["admin"])

        posted = client.post(_list_url(workspace, project), payload, format="json")
        patched = client.patch(_detail_url(workspace, project, bug), payload, format="json")

        assert posted.status_code == patched.status_code == status.HTTP_400_BAD_REQUEST

    def test_setting_the_project_default_moves_the_flag(self, workspace, users, project, default_type, bug):
        ProjectIssueType.objects.create(project=project, issue_type=bug)

        response = _client(users["project_admin"]).patch(
            _detail_url(workspace, project, bug), {"is_default": True}, format="json"
        )

        assert response.status_code == status.HTTP_200_OK, response.data
        assert response.data["is_default"] is True
        assert ProjectIssueType.objects.get(project=project, is_default=True).issue_type_id == bug.id
        entry = AuditLog.objects.get(action="project_issue_type.default_changed")
        assert entry.before == {"default_issue_type_id": str(default_type.id)}
        assert entry.after == {"default_issue_type_id": str(bug.id)}

    @pytest.mark.parametrize("value", [1, 1.0, "true", "True", [True], {"v": True}, None, False, 0])
    def test_is_default_must_be_the_json_boolean_true(self, workspace, users, project, default_type, bug, value):
        ProjectIssueType.objects.create(project=project, issue_type=bug)

        response = _client(users["admin"]).patch(
            _detail_url(workspace, project, bug), {"is_default": value}, format="json"
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert ProjectIssueType.objects.get(project=project, is_default=True).issue_type_id == default_type.id
        assert not AuditLog.objects.filter(action="project_issue_type.default_changed").exists()

    def test_a_missing_is_default_is_rejected(self, workspace, users, project, bug):
        ProjectIssueType.objects.create(project=project, issue_type=bug)
        response = _client(users["admin"]).patch(_detail_url(workspace, project, bug), {}, format="json")
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_setting_the_current_default_again_changes_nothing(self, workspace, users, project, default_type):
        response = _client(users["admin"]).patch(
            _detail_url(workspace, project, default_type), {"is_default": True}, format="json"
        )
        assert response.status_code == status.HTTP_200_OK
        assert not AuditLog.objects.filter(action="project_issue_type.default_changed").exists()

    def test_an_inactive_enabled_type_cannot_become_the_project_default(self, workspace, users, project, bug):
        ProjectIssueType.objects.create(project=project, issue_type=bug)
        IssueType.objects.filter(pk=bug.pk).update(is_active=False)
        response = _client(users["admin"]).patch(
            _detail_url(workspace, project, bug), {"is_default": True}, format="json"
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_only_setting_the_default_is_supported(self, workspace, users, project, default_type):
        response = _client(users["admin"]).patch(
            _detail_url(workspace, project, default_type), {"is_default": False}, format="json"
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert ProjectIssueType.objects.get(project=project, is_default=True).issue_type_id == default_type.id

    def test_a_type_not_enabled_in_the_project_looks_missing(self, workspace, users, project, bug):
        response = _client(users["admin"]).patch(
            _detail_url(workspace, project, bug), {"is_default": True}, format="json"
        )
        assert response.status_code == status.HTTP_404_NOT_FOUND

    def test_the_project_default_cannot_be_removed(self, workspace, users, project, default_type, mock_celery):
        response = _client(users["admin"]).delete(_detail_url(workspace, project, default_type))
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert ProjectIssueType.objects.filter(project=project, issue_type=default_type).exists()

    def test_a_type_used_by_project_work_items_cannot_be_removed(self, workspace, users, project, bug, mock_celery):
        ProjectIssueType.objects.create(project=project, issue_type=bug)
        Issue.objects.create(name="Bug item", project=project, type=bug)

        response = _client(users["admin"]).delete(_detail_url(workspace, project, bug))

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert ProjectIssueType.objects.filter(project=project, issue_type=bug).exists()

    def test_an_unused_type_is_removed_and_audited(self, workspace, users, project, bug, mock_celery):
        link = ProjectIssueType.objects.create(project=project, issue_type=bug)

        response = _client(users["admin"]).delete(_detail_url(workspace, project, bug))

        assert response.status_code == status.HTTP_204_NO_CONTENT
        assert not ProjectIssueType.objects.filter(pk=link.pk).exists()
        entry = AuditLog.objects.get(target_id=link.id, action="project_issue_type.disabled")
        assert entry.before["issue_type_id"] == str(bug.id) and entry.after is None


@pytest.mark.contract
@pytest.mark.django_db
class TestProjectIssueTypeBoundaries:
    @pytest.fixture
    def other_project(self, workspace, users):
        other = Project.objects.create(name="Other", identifier="OTH", workspace=workspace, created_by=users["admin"])
        ProjectMember.objects.create(project=other, member=users["member"], role=20)
        return other

    def _assert_all_refused(self, client, workspace, project, bug):
        enabled = client.post(_list_url(workspace, project), {"issue_type_id": str(bug.id)}, format="json")
        defaulted = client.patch(_detail_url(workspace, project, bug), {"is_default": True}, format="json")
        removed = client.delete(_detail_url(workspace, project, bug))
        assert enabled.status_code == defaulted.status_code == removed.status_code == status.HTTP_403_FORBIDDEN
        assert ProjectIssueType.objects.filter(project=project, issue_type=bug).exists()
        assert not AuditLog.objects.exists()

    def test_an_admin_of_another_project_cannot_change_this_one(
        self, workspace, users, project, other_project, bug, mock_celery
    ):
        ProjectIssueType.objects.create(project=project, issue_type=bug)
        self._assert_all_refused(_client(users["member"]), workspace, project, bug)

    def test_an_inactive_project_admin_cannot_change_the_project(self, workspace, users, project, bug, mock_celery):
        ProjectIssueType.objects.create(project=project, issue_type=bug)
        ProjectMember.objects.filter(project=project, member=users["project_admin"]).update(is_active=False)
        self._assert_all_refused(_client(users["project_admin"]), workspace, project, bug)

    def test_a_soft_deleted_type_cannot_be_enabled(self, workspace, users, project, bug):
        bug.delete()
        response = _client(users["admin"]).post(
            _list_url(workspace, project), {"issue_type_id": str(bug.id)}, format="json"
        )
        assert response.status_code == status.HTTP_404_NOT_FOUND

    def test_a_soft_deleted_work_item_does_not_block_removal(self, workspace, users, project, bug, mock_celery):
        ProjectIssueType.objects.create(project=project, issue_type=bug)
        Issue.objects.create(name="Gone", project=project, type=bug).delete()

        response = _client(users["admin"]).delete(_detail_url(workspace, project, bug))

        assert response.status_code == status.HTTP_204_NO_CONTENT
