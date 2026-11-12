# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from unittest.mock import patch
from uuid import uuid4

import pytest
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from plane.db.models import AuditLog, Issue, IssueType, Project, ProjectIssueType, WorkspaceMember
from plane.db.models.issue_type import DEFAULT_ISSUE_TYPE_LOGO_PROPS
from plane.tests.factories import IssueTypeFactory, UserFactory, WorkspaceFactory

LIST_URL = "/api/workspaces/{slug}/issue-types/"
DETAIL_URL = "/api/workspaces/{slug}/issue-types/{pk}/"


def _client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def users(db, workspace, create_user):
    member = UserFactory()
    guest = UserFactory()
    WorkspaceMember.objects.create(workspace=workspace, member=member, role=15)
    WorkspaceMember.objects.create(workspace=workspace, member=guest, role=5)
    return {"admin": create_user, "member": member, "guest": guest}


@pytest.fixture
def default_type(workspace):
    return IssueType.objects.get(workspace=workspace, is_default=True)


@pytest.fixture
def bug(workspace):
    return IssueTypeFactory(workspace=workspace, name="Bug")


@pytest.fixture
def project(workspace, create_user):
    return Project.objects.create(name="Home", identifier="HOME", workspace=workspace, created_by=create_user)


@pytest.mark.contract
@pytest.mark.django_db
class TestWorkspaceIssueTypeRead:
    @pytest.mark.parametrize("role", ["admin", "member", "guest"])
    def test_every_member_lists_types_with_counts(self, workspace, users, default_type, bug, project, role):
        Issue.objects.create(name="Item", project=project)

        response = _client(users[role]).get(LIST_URL.format(slug=workspace.slug))

        assert response.status_code == status.HTTP_200_OK, response.data
        rows = {str(row["id"]): row for row in response.data}
        assert list(rows)[0] == str(default_type.id)
        assert rows[str(default_type.id)]["issue_count"] == 1
        assert rows[str(default_type.id)]["project_default_count"] == 1
        assert rows[str(default_type.id)]["is_default"] is True
        assert rows[str(bug.id)]["issue_count"] == 0

    @pytest.mark.parametrize("role", ["admin", "member", "guest"])
    def test_every_member_reads_one_type(self, workspace, users, bug, role):
        response = _client(users[role]).get(DETAIL_URL.format(slug=workspace.slug, pk=bug.id))
        assert response.status_code == status.HTTP_200_OK, response.data
        assert response.data["name"] == "Bug"

    def test_non_member_is_refused(self, workspace, bug):
        response = _client(UserFactory()).get(LIST_URL.format(slug=workspace.slug))
        assert response.status_code == status.HTTP_403_FORBIDDEN

    def test_a_type_of_another_workspace_looks_missing(self, workspace, users):
        foreign = IssueTypeFactory(workspace=WorkspaceFactory(), name="Foreign")
        client = _client(users["admin"])

        missing = client.get(DETAIL_URL.format(slug=workspace.slug, pk=uuid4()))
        hidden = client.get(DETAIL_URL.format(slug=workspace.slug, pk=foreign.id))

        assert missing.status_code == hidden.status_code == status.HTTP_404_NOT_FOUND
        assert missing.data == hidden.data


@pytest.mark.contract
@pytest.mark.django_db
class TestWorkspaceIssueTypeWrite:
    @pytest.mark.parametrize("role", ["member", "guest"])
    def test_non_admins_cannot_write(self, workspace, users, bug, role, mock_celery):
        client = _client(users[role])

        created = client.post(LIST_URL.format(slug=workspace.slug), {"name": "Story"}, format="json")
        updated = client.patch(DETAIL_URL.format(slug=workspace.slug, pk=bug.id), {"name": "Story"}, format="json")
        deleted = client.delete(DETAIL_URL.format(slug=workspace.slug, pk=bug.id))

        assert created.status_code == updated.status_code == deleted.status_code == status.HTTP_403_FORBIDDEN
        bug.refresh_from_db()
        assert bug.name == "Bug" and bug.deleted_at is None
        assert not IssueType.objects.filter(workspace=workspace, name="Story").exists()
        assert not AuditLog.objects.exists()

    def test_admin_creates_a_type_with_a_trimmed_name_and_the_default_icon(self, workspace, users):
        response = _client(users["admin"]).post(
            LIST_URL.format(slug=workspace.slug), {"name": "  Story  ", "description": "User need"}, format="json"
        )

        assert response.status_code == status.HTTP_201_CREATED, response.data
        created = IssueType.objects.get(pk=response.data["id"])
        assert created.name == "Story"
        assert created.is_active and not created.is_default
        assert created.logo_props == DEFAULT_ISSUE_TYPE_LOGO_PROPS
        assert response.data["issue_count"] == 0
        entry = AuditLog.objects.get(target_id=created.id)
        assert entry.action == "issue_type.created"
        assert entry.actor_id == users["admin"].id
        assert entry.workspace_id == workspace.id
        assert entry.before is None
        assert entry.after["name"] == "Story"

    def test_is_default_cannot_be_set_at_creation(self, workspace, users, default_type):
        response = _client(users["admin"]).post(
            LIST_URL.format(slug=workspace.slug), {"name": "Story", "is_default": True}, format="json"
        )
        assert response.status_code == status.HTTP_201_CREATED, response.data
        assert IssueType.objects.get(workspace=workspace, is_default=True) == default_type

    @pytest.mark.parametrize("name", ["", "   ", "x" * 256, "bug", " BUG "])
    def test_invalid_names_are_rejected(self, workspace, users, bug, name):
        response = _client(users["admin"]).post(LIST_URL.format(slug=workspace.slug), {"name": name}, format="json")
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "name" in response.data
        assert not AuditLog.objects.exists()

    def test_too_long_description_is_rejected(self, workspace, users):
        response = _client(users["admin"]).post(
            LIST_URL.format(slug=workspace.slug), {"name": "Story", "description": "x" * 1001}, format="json"
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    @pytest.mark.parametrize(
        "logo_props",
        [
            {"in_use": "icon", "icon": {"name": "bug_report", "color": "red"}},
            {"in_use": "icon", "icon": {"name": "<script>", "color": "#ff0000"}},
            {"in_use": "icon", "icon": {"name": "bug_report"}, "extra": 1},
            {"in_use": "emoji", "emoji": {"value": "128512", "url": "https://tracker.example/pixel.png"}},
            {"in_use": "emoji", "emoji": {"value": "smile"}},
            {"in_use": "image"},
            "not-an-object",
            {"in_use": "icon", "icon": {"name": "bug_report", "color": "#ffffff\n"}},
            {"in_use": "icon", "icon": {"name": "bug_report\n"}},
            {"in_use": "emoji", "emoji": {"value": "128512\n"}},
            {"in_use": "emoji", "emoji": {"value": "128512-1114112"}},
        ],
    )
    def test_unexpected_logo_props_are_rejected(self, workspace, users, logo_props):
        response = _client(users["admin"]).post(
            LIST_URL.format(slug=workspace.slug), {"name": "Story", "logo_props": logo_props}, format="json"
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "logo_props" in response.data

    @pytest.mark.parametrize(
        "logo_props",
        [
            {"in_use": "icon", "icon": {"name": "bug_report", "color": "#e57a00", "background_color": "#FFFFFF"}},
            {"in_use": "emoji", "emoji": {"value": "128104-8205-128187"}},
        ],
    )
    def test_expected_logo_props_are_stored(self, workspace, users, logo_props):
        response = _client(users["admin"]).post(
            LIST_URL.format(slug=workspace.slug), {"name": "Story", "logo_props": logo_props}, format="json"
        )
        assert response.status_code == status.HTTP_201_CREATED, response.data
        assert IssueType.objects.get(pk=response.data["id"]).logo_props == logo_props

    def test_admin_renames_a_type_and_the_audit_keeps_before_and_after(self, workspace, users, bug):
        response = _client(users["admin"]).patch(
            DETAIL_URL.format(slug=workspace.slug, pk=bug.id), {"name": "Defect"}, format="json"
        )

        assert response.status_code == status.HTTP_200_OK, response.data
        assert response.data["name"] == "Defect"
        entry = AuditLog.objects.get(target_id=bug.id, action="issue_type.updated")
        assert entry.before["name"] == "Bug"
        assert entry.after["name"] == "Defect"

    def test_renaming_to_an_existing_name_ignoring_case_is_rejected(self, workspace, users, bug, default_type):
        response = _client(users["admin"]).patch(
            DETAIL_URL.format(slug=workspace.slug, pk=bug.id), {"name": default_type.name.upper()}, format="json"
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_setting_a_new_default_removes_the_previous_one(self, workspace, users, default_type, bug):
        response = _client(users["admin"]).patch(
            DETAIL_URL.format(slug=workspace.slug, pk=bug.id), {"is_default": True}, format="json"
        )

        assert response.status_code == status.HTTP_200_OK, response.data
        default_type.refresh_from_db()
        bug.refresh_from_db()
        assert bug.is_default and not default_type.is_default
        assert IssueType.objects.filter(workspace=workspace, is_default=True).count() == 1
        entry = AuditLog.objects.get(target_id=bug.id, action="issue_type.updated")
        assert entry.before["is_default"] is False and entry.after["is_default"] is True

    def test_unsetting_the_default_is_rejected(self, workspace, users, default_type):
        response = _client(users["admin"]).patch(
            DETAIL_URL.format(slug=workspace.slug, pk=default_type.id), {"is_default": False}, format="json"
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        default_type.refresh_from_db()
        assert default_type.is_default

    def test_the_default_type_cannot_be_deactivated(self, workspace, users, default_type):
        response = _client(users["admin"]).patch(
            DETAIL_URL.format(slug=workspace.slug, pk=default_type.id), {"is_active": False}, format="json"
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        default_type.refresh_from_db()
        assert default_type.is_active

    def test_an_inactive_type_cannot_become_the_default(self, workspace, users, bug):
        IssueType.objects.filter(pk=bug.pk).update(is_active=False)
        response = _client(users["admin"]).patch(
            DETAIL_URL.format(slug=workspace.slug, pk=bug.id), {"is_default": True}, format="json"
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    @pytest.mark.parametrize("payload", [{"is_default": 1}, {"is_default": 1, "is_active": False}])
    def test_is_default_must_be_exactly_true(self, workspace, users, default_type, bug, payload):
        IssueType.objects.filter(pk=bug.pk).update(is_active=payload.get("is_active", False))

        response = _client(users["admin"]).patch(
            DETAIL_URL.format(slug=workspace.slug, pk=bug.id), payload, format="json"
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        bug.refresh_from_db()
        default_type.refresh_from_db()
        assert default_type.is_default and not bug.is_default
        assert not AuditLog.objects.exists()

    @pytest.mark.parametrize("method", ["post", "patch"])
    @pytest.mark.parametrize("body", [["name", "Story"], "Story", 1])
    def test_a_non_object_body_is_rejected(self, workspace, users, bug, method, body):
        url = (
            LIST_URL.format(slug=workspace.slug)
            if method == "post"
            else DETAIL_URL.format(slug=workspace.slug, pk=bug.id)
        )

        response = getattr(_client(users["admin"]), method)(url, body, format="json")

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert not AuditLog.objects.exists()

    def test_a_project_default_type_cannot_be_deactivated(self, workspace, users, bug, project):
        ProjectIssueType.objects.filter(project=project).update(is_default=False)
        ProjectIssueType.objects.create(project=project, issue_type=bug, is_default=True)

        response = _client(users["admin"]).patch(
            DETAIL_URL.format(slug=workspace.slug, pk=bug.id), {"is_active": False}, format="json"
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        bug.refresh_from_db()
        assert bug.is_active

    def test_a_type_can_be_deactivated_then_reactivated(self, workspace, users, bug):
        client = _client(users["admin"])
        url = DETAIL_URL.format(slug=workspace.slug, pk=bug.id)

        assert client.patch(url, {"is_active": False}, format="json").status_code == status.HTTP_200_OK
        bug.refresh_from_db()
        assert not bug.is_active
        assert client.patch(url, {"is_active": True}, format="json").status_code == status.HTTP_200_OK
        bug.refresh_from_db()
        assert bug.is_active

    def test_the_default_type_cannot_be_deleted(self, workspace, users, default_type, mock_celery):
        response = _client(users["admin"]).delete(DETAIL_URL.format(slug=workspace.slug, pk=default_type.id))
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert IssueType.objects.filter(pk=default_type.pk).exists()

    def test_a_type_used_by_work_items_cannot_be_deleted(self, workspace, users, bug, project, mock_celery):
        ProjectIssueType.objects.create(project=project, issue_type=bug)
        Issue.objects.create(name="Bug item", project=project, type=bug)

        response = _client(users["admin"]).delete(DETAIL_URL.format(slug=workspace.slug, pk=bug.id))

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert IssueType.objects.filter(pk=bug.pk).exists()

    def test_a_type_used_only_by_deleted_work_items_is_soft_deleted(self, workspace, users, bug, project, mock_celery):
        ProjectIssueType.objects.create(project=project, issue_type=bug)
        issue = Issue.objects.create(name="Gone", project=project, type=bug)
        Issue.all_objects.filter(pk=issue.pk).update(deleted_at=timezone.now())

        response = _client(users["admin"]).delete(DETAIL_URL.format(slug=workspace.slug, pk=bug.id))

        assert response.status_code == status.HTTP_204_NO_CONTENT
        assert not IssueType.objects.filter(pk=bug.pk).exists()
        assert IssueType.all_objects.get(pk=bug.pk).deleted_at is not None
        entry = AuditLog.objects.get(target_id=bug.id, action="issue_type.deleted")
        assert entry.before["name"] == "Bug" and entry.after is None

    def test_a_failed_audit_deletes_nothing_and_enqueues_nothing(self, workspace, users, bug, mock_celery):
        with patch("plane.app.views.issue_type.base.record_audit", side_effect=RuntimeError("audit down")):
            response = _client(users["admin"]).delete(DETAIL_URL.format(slug=workspace.slug, pk=bug.id))

        assert response.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR
        assert IssueType.objects.filter(pk=bug.pk).exists()
        # The soft-delete cascade runs in a worker outside the transaction: it must not be queued.
        mock_celery.assert_not_called()

    def test_admin_cannot_touch_a_type_of_another_workspace(self, workspace, users, mock_celery):
        foreign = IssueTypeFactory(workspace=WorkspaceFactory(), name="Foreign")
        client = _client(users["admin"])
        url = DETAIL_URL.format(slug=workspace.slug, pk=foreign.id)

        assert client.patch(url, {"name": "Hijack"}, format="json").status_code == status.HTTP_404_NOT_FOUND
        assert client.delete(url).status_code == status.HTTP_404_NOT_FOUND
        foreign.refresh_from_db()
        assert foreign.name == "Foreign" and foreign.deleted_at is None

    def test_a_project_default_type_cannot_be_deleted(self, workspace, users, bug, project, mock_celery):
        ProjectIssueType.objects.filter(project=project).update(is_default=False)
        ProjectIssueType.objects.create(project=project, issue_type=bug, is_default=True)

        response = _client(users["admin"]).delete(DETAIL_URL.format(slug=workspace.slug, pk=bug.id))

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "error" in response.data
        assert IssueType.objects.filter(pk=bug.pk).exists()
        assert not AuditLog.objects.exists()


@pytest.mark.contract
@pytest.mark.django_db
class TestWorkspaceIssueTypeNameRace:
    """A duplicate that slips past the serializer check must still end in a 400 on name, not a 500."""

    @pytest.fixture(autouse=True)
    def skip_name_check(self):
        with patch("plane.app.serializers.issue_type.IssueTypeSerializer.validate_name", lambda self, value: value):
            yield

    def test_create_with_a_name_taken_concurrently(self, workspace, users, bug):
        response = _client(users["admin"]).post(LIST_URL.format(slug=workspace.slug), {"name": "BUG"}, format="json")

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "name" in response.data
        assert not AuditLog.objects.exists()

    def test_rename_to_a_name_taken_concurrently(self, workspace, users, bug, default_type):
        response = _client(users["admin"]).patch(
            DETAIL_URL.format(slug=workspace.slug, pk=bug.id), {"name": default_type.name.upper()}, format="json"
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "name" in response.data
        bug.refresh_from_db()
        assert bug.name == "Bug"
        assert not AuditLog.objects.exists()
