# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Django imports
from django.db import IntegrityError, transaction
from django.db.models import Count

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.permissions import ROLE, allow_permission
from plane.app.serializers import WorkflowGraphInputSerializer, WorkflowSerializer, WorkflowStatusSerializer
from plane.app.serializers.workflow import DUPLICATE_WORKFLOW_NAME_MESSAGE
from plane.db.models import Workflow, WorkflowState, WorkflowStatus, Workspace, WorkspaceMember
from plane.utils.audit import record_audit
from plane.utils.workflow_graph import GraphError, save_workflow_graph, workflow_graph
from plane.utils.workflow_sync import projects_using
from ..base import BaseAPIView

METHOD_NOT_ALLOWED = {"error": "Method not allowed on this route."}
NOT_AN_OBJECT = {"error": "The payload must be an object."}
WORKFLOW_NAME_CONSTRAINT = "workflow_unique_lower_name_workspace_when_deleted_at_null"
STATUS_NAME_CONSTRAINT = "workflow_status_unique_lower_name_ws_when_deleted_at_null"


def _constraint_name(error):
    return getattr(getattr(error.__cause__, "diag", None), "constraint_name", None)


def is_workspace_admin(user, slug):
    return WorkspaceMember.objects.filter(
        member=user, workspace__slug=slug, role=ROLE.ADMIN.value, is_active=True
    ).exists()


def _projects(workflow, is_admin):
    projects = projects_using(workflow.id).order_by("name")
    data = {"project_count": projects.count()}
    # Members read workflows (A1) but private project names stay with admins (P6).
    if is_admin:
        data["projects"] = [{"id": str(project.id), "name": project.name} for project in projects]
    return data


def workflow_detail(workflow, is_admin):
    return {**workflow_graph(workflow), **_projects(workflow, is_admin)}


def _workflow_snapshot(workflow):
    return {"name": workflow.name, "description": workflow.description}


class WorkflowStatusEndpoint(BaseAPIView):
    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def get(self, request, slug, pk=None):
        if pk is not None:
            return Response(METHOD_NOT_ALLOWED, status=status.HTTP_405_METHOD_NOT_ALLOWED)
        statuses = WorkflowStatus.objects.filter(workspace__slug=slug).annotate(workflow_count=Count("workflow_states"))
        return Response(WorkflowStatusSerializer(statuses, many=True).data, status=status.HTTP_200_OK)

    @allow_permission(allowed_roles=[ROLE.ADMIN], level="WORKSPACE")
    def delete(self, request, slug, pk=None):
        if pk is None:
            return Response(METHOD_NOT_ALLOWED, status=status.HTTP_405_METHOD_NOT_ALLOWED)
        with transaction.atomic():
            workflow_status = WorkflowStatus.objects.select_for_update(of=("self",)).get(workspace__slug=slug, pk=pk)
            if WorkflowState.objects.filter(status_id=workflow_status.id).exists():
                return Response({"error": "status_in_use"}, status=status.HTTP_400_BAD_REQUEST)
            record_audit(
                workspace_id=workflow_status.workspace_id,
                actor_id=request.user.id,
                action="workflow_status.deleted",
                target_type="workflow_status",
                target_id=workflow_status.id,
                before={"name": workflow_status.name, "color": workflow_status.color, "group": workflow_status.group},
            )
            # Queryset delete: soft, without the per-row cascade task.
            WorkflowStatus.objects.filter(pk=workflow_status.pk).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class WorkflowEndpoint(BaseAPIView):
    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def get(self, request, slug, pk=None):
        is_admin = is_workspace_admin(request.user, slug)
        if pk is not None:
            workflow = Workflow.objects.get(workspace__slug=slug, pk=pk)
            return Response(workflow_detail(workflow, is_admin), status=status.HTTP_200_OK)
        workflows = Workflow.objects.filter(workspace__slug=slug).annotate(state_count=Count("states"))
        data = [
            {**WorkflowSerializer(workflow).data, "state_count": workflow.state_count, **_projects(workflow, is_admin)}
            for workflow in workflows
        ]
        return Response(data, status=status.HTTP_200_OK)

    @allow_permission(allowed_roles=[ROLE.ADMIN], level="WORKSPACE")
    def post(self, request, slug, pk=None):
        if pk is not None:
            return Response(METHOD_NOT_ALLOWED, status=status.HTTP_405_METHOD_NOT_ALLOWED)
        workspace = Workspace.objects.get(slug=slug)
        serializer = WorkflowSerializer(data=request.data, context={"workspace_id": workspace.id})
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        try:
            with transaction.atomic():
                workflow = serializer.save(workspace_id=workspace.id)
                record_audit(
                    workspace_id=workspace.id,
                    actor_id=request.user.id,
                    action="workflow.created",
                    target_type="workflow",
                    target_id=workflow.id,
                    after=_workflow_snapshot(workflow),
                )
        except IntegrityError as error:
            if _constraint_name(error) != WORKFLOW_NAME_CONSTRAINT:
                raise
            return Response({"name": [DUPLICATE_WORKFLOW_NAME_MESSAGE]}, status=status.HTTP_400_BAD_REQUEST)
        return Response(workflow_detail(workflow, True), status=status.HTTP_201_CREATED)

    @allow_permission(allowed_roles=[ROLE.ADMIN], level="WORKSPACE")
    def patch(self, request, slug, pk=None):
        if pk is None:
            return Response(METHOD_NOT_ALLOWED, status=status.HTTP_405_METHOD_NOT_ALLOWED)
        if not isinstance(request.data, dict):
            return Response(NOT_AN_OBJECT, status=status.HTTP_400_BAD_REQUEST)
        try:
            with transaction.atomic():
                workflow = Workflow.objects.select_for_update(of=("self",)).get(workspace__slug=slug, pk=pk)
                before = _workflow_snapshot(workflow)
                serializer = WorkflowSerializer(
                    workflow, data=request.data, partial=True, context={"workspace_id": workflow.workspace_id}
                )
                if not serializer.is_valid():
                    return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
                workflow = serializer.save()
                record_audit(
                    workspace_id=workflow.workspace_id,
                    actor_id=request.user.id,
                    action="workflow.updated",
                    target_type="workflow",
                    target_id=workflow.id,
                    before=before,
                    after=_workflow_snapshot(workflow),
                )
        except IntegrityError as error:
            if _constraint_name(error) != WORKFLOW_NAME_CONSTRAINT:
                raise
            return Response({"name": [DUPLICATE_WORKFLOW_NAME_MESSAGE]}, status=status.HTTP_400_BAD_REQUEST)
        return Response(workflow_detail(workflow, True), status=status.HTTP_200_OK)

    @allow_permission(allowed_roles=[ROLE.ADMIN], level="WORKSPACE")
    def delete(self, request, slug, pk=None):
        if pk is None:
            return Response(METHOD_NOT_ALLOWED, status=status.HTTP_405_METHOD_NOT_ALLOWED)
        with transaction.atomic():
            workflow = Workflow.objects.select_for_update(of=("self",)).get(workspace__slug=slug, pk=pk)
            if projects_using(workflow.id).exists():
                return Response({"error": "workflow_in_use"}, status=status.HTTP_400_BAD_REQUEST)
            record_audit(
                workspace_id=workflow.workspace_id,
                actor_id=request.user.id,
                action="workflow.deleted",
                target_type="workflow",
                target_id=workflow.id,
                before=workflow_graph(workflow),
            )
            # The graph rows go for good (P2), which frees the statuses they referenced.
            WorkflowState.objects.filter(workflow_id=workflow.id).delete()
            Workflow.objects.filter(pk=workflow.pk).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class WorkflowGraphEndpoint(BaseAPIView):
    @allow_permission(allowed_roles=[ROLE.ADMIN], level="WORKSPACE")
    def put(self, request, slug, pk):
        if not isinstance(request.data, dict):
            return Response(NOT_AN_OBJECT, status=status.HTTP_400_BAD_REQUEST)
        workspace = Workspace.objects.get(slug=slug)
        serializer = WorkflowGraphInputSerializer(data=request.data, context={"workspace_id": workspace.id})
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        try:
            with transaction.atomic():
                workflow = Workflow.objects.select_for_update(of=("self",)).get(workspace_id=workspace.id, pk=pk)
                save_workflow_graph(workflow=workflow, graph=serializer.validated_data, actor_id=request.user.id)
        except GraphError as error:
            body = {"graph": [error.code]}
            if error.details:
                body["projects"] = error.details
            return Response(body, status=status.HTTP_400_BAD_REQUEST)
        except IntegrityError as error:
            if _constraint_name(error) != STATUS_NAME_CONSTRAINT:
                raise
            return Response({"graph": ["duplicate_status_name"]}, status=status.HTTP_400_BAD_REQUEST)
        workflow.refresh_from_db()
        return Response(workflow_detail(workflow, True), status=status.HTTP_200_OK)
