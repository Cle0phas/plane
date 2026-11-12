# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Python imports
import copy
import uuid

# Django imports
from django.db import IntegrityError, transaction
from django.db.models import Count, IntegerField, OuterRef, Subquery, Value
from django.db.models.functions import Coalesce

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.permissions import ROLE, allow_permission
from plane.app.serializers import IssueTypeSerializer, ProjectIssueTypeSerializer
from plane.app.serializers.issue_type import DUPLICATE_NAME_MESSAGE
from plane.db.models import (
    Issue,
    IssueType,
    Project,
    ProjectIssueType,
    ProjectMember,
    Workspace,
    WorkspaceMember,
)
from plane.db.models.issue_type import DEFAULT_ISSUE_TYPE_LOGO_PROPS
from plane.utils.audit import record_audit
from ..base import BaseAPIView


def count_subquery(queryset, field):
    """Correlated row count grouped on field, 0 when no row matches."""
    return Coalesce(
        Subquery(
            queryset.order_by().values(field).annotate(count=Count("id")).values("count")[:1],
            output_field=IntegerField(),
        ),
        Value(0),
    )


def workspace_issue_types(slug):
    return IssueType.objects.filter(workspace__slug=slug).annotate(
        issue_count=count_subquery(Issue.objects.filter(type_id=OuterRef("pk")), "type_id"),
        project_default_count=count_subquery(
            ProjectIssueType.objects.filter(issue_type_id=OuterRef("pk"), is_default=True), "issue_type_id"
        ),
    )


def issue_type_snapshot(issue_type):
    return {
        "name": issue_type.name,
        "description": issue_type.description,
        "logo_props": issue_type.logo_props,
        "is_active": issue_type.is_active,
        "is_default": issue_type.is_default,
    }


def _issue_type_update_error(issue_type, is_active, make_default):
    """Return why the update would break R5 or invariant 2, or None."""
    if make_default and not is_active:
        return "An inactive work item type cannot be the default."
    if not is_active and issue_type.is_default:
        return "The default work item type cannot be deactivated."
    if (
        not is_active
        and issue_type.is_active
        and ProjectIssueType.objects.filter(issue_type=issue_type, is_default=True).exists()
    ):
        return "This work item type is the default of a project."
    return None


def _issue_type_delete_error(issue_type):
    """Return why deleting would break R5, R6 or invariant 2, or None."""
    if issue_type.is_default:
        return "The default work item type cannot be deleted."
    if Issue.objects.filter(type_id=issue_type.id).exists():
        return "Work items still use this work item type."
    if ProjectIssueType.objects.filter(issue_type=issue_type, is_default=True).exists():
        return "This work item type is the default of a project."
    return None


def _duplicate_name_response(error):
    """Turn a lost race on the case-insensitive name constraint into the serializer's 400."""
    if getattr(getattr(error.__cause__, "diag", None), "constraint_name", None) != UNIQUE_NAME_CONSTRAINT:
        raise error
    return Response({"name": [DUPLICATE_NAME_MESSAGE]}, status=status.HTTP_400_BAD_REQUEST)


UNIQUE_NAME_CONSTRAINT = "issue_type_unique_lower_name_workspace_when_deleted_at_null"
METHOD_NOT_ALLOWED = {"error": "Method not allowed on this route."}


class WorkspaceIssueTypeEndpoint(BaseAPIView):
    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def get(self, request, slug, pk=None):
        issue_types = workspace_issue_types(slug)
        if pk is None:
            serializer = IssueTypeSerializer(issue_types.order_by("-is_default", "name"), many=True)
            return Response(serializer.data, status=status.HTTP_200_OK)
        return Response(IssueTypeSerializer(issue_types.get(pk=pk)).data, status=status.HTTP_200_OK)

    @allow_permission(allowed_roles=[ROLE.ADMIN], level="WORKSPACE")
    def post(self, request, slug, pk=None):
        if pk is not None:
            return Response(METHOD_NOT_ALLOWED, status=status.HTTP_405_METHOD_NOT_ALLOWED)
        workspace = Workspace.objects.get(slug=slug)
        serializer = IssueTypeSerializer(data=request.data, context={"workspace_id": workspace.id})
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        try:
            with transaction.atomic():
                issue_type = serializer.save(
                    workspace_id=workspace.id,
                    logo_props=serializer.validated_data.get("logo_props")
                    or copy.deepcopy(DEFAULT_ISSUE_TYPE_LOGO_PROPS),
                )
                record_audit(
                    workspace_id=workspace.id,
                    actor_id=request.user.id,
                    action="issue_type.created",
                    target_type="issue_type",
                    target_id=issue_type.id,
                    after=issue_type_snapshot(issue_type),
                )
        except IntegrityError as error:
            return _duplicate_name_response(error)
        data = IssueTypeSerializer(workspace_issue_types(slug).get(pk=issue_type.pk)).data
        return Response(data, status=status.HTTP_201_CREATED)

    @allow_permission(allowed_roles=[ROLE.ADMIN], level="WORKSPACE")
    def patch(self, request, slug, pk=None):
        if pk is None:
            return Response(METHOD_NOT_ALLOWED, status=status.HTTP_405_METHOD_NOT_ALLOWED)
        if not isinstance(request.data, dict):
            return Response({"error": "The payload must be an object."}, status=status.HTTP_400_BAD_REQUEST)
        # Identity check: JSON 1 equals True and must not slip past the R5 checks.
        if "is_default" in request.data and request.data["is_default"] is not True:
            return Response(
                {"error": "Choose another default work item type instead of unsetting this one."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        make_default = "is_default" in request.data
        try:
            with transaction.atomic():
                if make_default:
                    # Lock every type of the workspace in id order first, so concurrent default switches
                    # queue instead of deadlocking (R5).
                    list(
                        IssueType.objects.select_for_update(of=("self",))
                        .filter(workspace__slug=slug)
                        .order_by("id")
                        .values_list("id", flat=True)
                    )
                issue_type = IssueType.objects.select_for_update(of=("self",)).get(workspace__slug=slug, pk=pk)
                before = issue_type_snapshot(issue_type)
                serializer = IssueTypeSerializer(
                    issue_type, data=request.data, partial=True, context={"workspace_id": issue_type.workspace_id}
                )
                if not serializer.is_valid():
                    return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
                is_active = serializer.validated_data.get("is_active", issue_type.is_active)
                error = _issue_type_update_error(issue_type, is_active, make_default)
                if error:
                    return Response({"error": error}, status=status.HTTP_400_BAD_REQUEST)
                if make_default and not issue_type.is_default:
                    IssueType.objects.filter(workspace_id=issue_type.workspace_id, is_default=True).update(
                        is_default=False
                    )
                    issue_type = serializer.save(is_default=True)
                else:
                    issue_type = serializer.save()
                record_audit(
                    workspace_id=issue_type.workspace_id,
                    actor_id=request.user.id,
                    action="issue_type.updated",
                    target_type="issue_type",
                    target_id=issue_type.id,
                    before=before,
                    after=issue_type_snapshot(issue_type),
                )
        except IntegrityError as error:
            return _duplicate_name_response(error)
        return Response(
            IssueTypeSerializer(workspace_issue_types(slug).get(pk=issue_type.pk)).data, status=status.HTTP_200_OK
        )

    @allow_permission(allowed_roles=[ROLE.ADMIN], level="WORKSPACE")
    def delete(self, request, slug, pk=None):
        if pk is None:
            return Response(METHOD_NOT_ALLOWED, status=status.HTTP_405_METHOD_NOT_ALLOWED)
        with transaction.atomic():
            issue_type = IssueType.objects.select_for_update(of=("self",)).get(workspace__slug=slug, pk=pk)
            error = _issue_type_delete_error(issue_type)
            if error:
                return Response({"error": error}, status=status.HTTP_400_BAD_REQUEST)
            before = issue_type_snapshot(issue_type)
            issue_type.delete()
            record_audit(
                workspace_id=issue_type.workspace_id,
                actor_id=request.user.id,
                action="issue_type.deleted",
                target_type="issue_type",
                target_id=issue_type.id,
                before=before,
            )
        return Response(status=status.HTTP_204_NO_CONTENT)


FORBIDDEN = {"error": "You don't have the required permissions."}
NOT_AN_OBJECT = {"error": "The payload must be an object."}
DEFAULT_CONSTRAINT_ERROR = {"error": "The project default work item type changed concurrently, retry."}


def can_manage_project_issue_types(user, slug, project_id):
    """R3: workspace admins, even outside the project, and admins of the project."""
    if WorkspaceMember.objects.filter(
        member=user, workspace__slug=slug, role=ROLE.ADMIN.value, is_active=True
    ).exists():
        return True
    return ProjectMember.objects.filter(
        member=user, workspace__slug=slug, project_id=project_id, role=ROLE.ADMIN.value, is_active=True
    ).exists()


def _require_project_manager(request, slug, project_id):
    """Return the 403 response when the caller may not manage the project types, else None."""
    if can_manage_project_issue_types(request.user, slug, project_id):
        return None
    return Response(FORBIDDEN, status=status.HTTP_403_FORBIDDEN)


def project_issue_types(slug, project_id):
    return ProjectIssueType.objects.filter(
        project_id=project_id, project__workspace__slug=slug, issue_type__deleted_at__isnull=True
    ).annotate(
        issue_count=count_subquery(
            Issue.objects.filter(project_id=OuterRef("project_id"), type_id=OuterRef("issue_type_id")), "type_id"
        )
    )


def project_issue_type_snapshot(link):
    return {"project_id": str(link.project_id), "issue_type_id": str(link.issue_type_id), "is_default": link.is_default}


class ProjectIssueTypeListEndpoint(BaseAPIView):
    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def get(self, request, slug, project_id):
        project = Project.objects.get(workspace__slug=slug, pk=project_id)
        links = project_issue_types(slug, project.id).order_by("-is_default", "issue_type__name")
        return Response(ProjectIssueTypeSerializer(links, many=True).data, status=status.HTTP_200_OK)

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def post(self, request, slug, project_id):
        refusal = _require_project_manager(request, slug, project_id)
        if refusal:
            return refusal
        if not isinstance(request.data, dict):
            return Response(NOT_AN_OBJECT, status=status.HTTP_400_BAD_REQUEST)
        raw_type_id = request.data.get("issue_type_id")
        try:
            requested_type_id = uuid.UUID(raw_type_id) if isinstance(raw_type_id, str) else None
        except ValueError:
            requested_type_id = None
        if requested_type_id is None:
            return Response({"error": "issue_type_id must be a valid UUID."}, status=status.HTTP_400_BAD_REQUEST)
        project = Project.objects.get(workspace__slug=slug, pk=project_id)
        with transaction.atomic():
            # Lock the type so a concurrent deactivation cannot slip past the is_active check (R7).
            issue_type = IssueType.objects.select_for_update(of=("self",)).get(
                workspace__slug=slug, pk=requested_type_id
            )
            if not issue_type.is_active:
                return Response(
                    {"error": "An inactive work item type cannot be enabled in a project."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            link, created = ProjectIssueType.objects.get_or_create(project=project, issue_type=issue_type)
            if created:
                record_audit(
                    workspace_id=project.workspace_id,
                    actor_id=request.user.id,
                    action="project_issue_type.enabled",
                    target_type="project_issue_type",
                    target_id=link.id,
                    after=project_issue_type_snapshot(link),
                )
        data = ProjectIssueTypeSerializer(project_issue_types(slug, project.id).get(pk=link.pk)).data
        return Response(data, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)


class ProjectIssueTypeDetailEndpoint(BaseAPIView):
    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def patch(self, request, slug, project_id, issue_type_id):
        refusal = _require_project_manager(request, slug, project_id)
        if refusal:
            return refusal
        if not isinstance(request.data, dict):
            return Response(NOT_AN_OBJECT, status=status.HTTP_400_BAD_REQUEST)
        # Identity check: JSON 1, 1.0 and "true" must not count as true.
        if request.data.get("is_default") is not True:
            return Response(
                {"error": "Only setting is_default to true is supported."}, status=status.HTTP_400_BAD_REQUEST
            )
        try:
            with transaction.atomic():
                # Lock every link of the project in id order, so concurrent default switches queue
                # instead of deadlocking (invariant 2, R5, R6).
                links = list(
                    ProjectIssueType.objects.select_for_update(of=("self",))
                    .select_related("issue_type")
                    .filter(project_id=project_id, project__workspace__slug=slug, issue_type__deleted_at__isnull=True)
                    .order_by("id")
                )
                link = next((item for item in links if item.issue_type_id == issue_type_id), None)
                if link is None:
                    raise ProjectIssueType.DoesNotExist
                # Lock the type after the links (Task 5 locks types only), then read is_active from the locked row.
                issue_type = IssueType.objects.select_for_update(of=("self",)).get(pk=link.issue_type_id)
                if not issue_type.is_active:
                    return Response(
                        {"error": "An inactive work item type cannot be the project default."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                previous = next((item for item in links if item.is_default), None)
                if previous is None or previous.pk != link.pk:
                    ProjectIssueType.objects.filter(pk__in=[item.pk for item in links if item.is_default]).update(
                        is_default=False
                    )
                    link.is_default = True
                    link.save(update_fields=["is_default", "updated_at"])
                    record_audit(
                        workspace_id=link.workspace_id,
                        actor_id=request.user.id,
                        action="project_issue_type.default_changed",
                        target_type="project_issue_type",
                        target_id=link.id,
                        before={"default_issue_type_id": str(previous.issue_type_id) if previous else None},
                        after={"default_issue_type_id": str(link.issue_type_id)},
                    )
        except IntegrityError:
            return Response(DEFAULT_CONSTRAINT_ERROR, status=status.HTTP_400_BAD_REQUEST)
        data = ProjectIssueTypeSerializer(project_issue_types(slug, project_id).get(pk=link.pk)).data
        return Response(data, status=status.HTTP_200_OK)

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def delete(self, request, slug, project_id, issue_type_id):
        refusal = _require_project_manager(request, slug, project_id)
        if refusal:
            return refusal
        with transaction.atomic():
            link = ProjectIssueType.objects.select_for_update(of=("self",)).get(
                project_id=project_id, project__workspace__slug=slug, issue_type_id=issue_type_id
            )
            if link.is_default:
                return Response(
                    {"error": "The project default work item type cannot be removed."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if Issue.objects.filter(project_id=project_id, type_id=issue_type_id).exists():
                return Response(
                    {"error": "Work items of this project use this work item type."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            before = project_issue_type_snapshot(link)
            link.delete()
            record_audit(
                workspace_id=link.workspace_id,
                actor_id=request.user.id,
                action="project_issue_type.disabled",
                target_type="project_issue_type",
                target_id=link.id,
                before=before,
            )
        return Response(status=status.HTTP_204_NO_CONTENT)
