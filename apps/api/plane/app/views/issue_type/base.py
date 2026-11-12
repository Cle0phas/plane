# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Python imports
import copy

# Django imports
from django.db import IntegrityError, transaction
from django.db.models import Count, IntegerField, OuterRef, Subquery, Value
from django.db.models.functions import Coalesce

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.permissions import ROLE, allow_permission
from plane.app.serializers import IssueTypeSerializer
from plane.app.serializers.issue_type import DUPLICATE_NAME_MESSAGE
from plane.db.models import Issue, IssueType, ProjectIssueType, Workspace
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
        make_default = request.data.get("is_default")
        if make_default not in (None, True):
            return Response(
                {"error": "Choose another default work item type instead of unsetting this one."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            with transaction.atomic():
                issue_type = IssueType.objects.select_for_update(of=("self",)).get(workspace__slug=slug, pk=pk)
                before = issue_type_snapshot(issue_type)
                serializer = IssueTypeSerializer(
                    issue_type, data=request.data, partial=True, context={"workspace_id": issue_type.workspace_id}
                )
                if not serializer.is_valid():
                    return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
                is_active = serializer.validated_data.get("is_active", issue_type.is_active)
                error = _issue_type_update_error(issue_type, is_active, make_default is True)
                if error:
                    return Response({"error": error}, status=status.HTTP_400_BAD_REQUEST)
                if make_default and not issue_type.is_default:
                    # Locking every type of the workspace serialises concurrent default changes (R5).
                    workspace_types = IssueType.objects.select_for_update().filter(workspace_id=issue_type.workspace_id)
                    list(workspace_types)
                    workspace_types.filter(is_default=True).update(is_default=False)
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
