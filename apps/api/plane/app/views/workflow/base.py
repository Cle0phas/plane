# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Django imports
from django.db import IntegrityError, transaction
from django.db.models import Count

# Third party imports
from rest_framework import serializers, status
from rest_framework.response import Response

# Module imports
from plane.app.permissions import ROLE, allow_permission
from plane.app.serializers import (
    ProjectWorkflowSchemeInputSerializer,
    WorkflowGraphInputSerializer,
    WorkflowSerializer,
    WorkflowStatusSerializer,
)
from plane.app.serializers.workflow import DUPLICATE_WORKFLOW_NAME_MESSAGE
from plane.app.views.issue_type.base import _require_project_manager
from plane.db.models import (
    Project,
    ProjectWorkflowScheme,
    Workflow,
    WorkflowState,
    WorkflowStatus,
    Workspace,
    WorkspaceMember,
)
from plane.utils.audit import record_audit
from plane.utils.issue_types import StrictUUIDField
from plane.utils.workflow_graph import GraphError, save_workflow_graph, workflow_graph
from plane.utils.workflow_seed import candidate_statuses, graph_copy, graph_from_project
from plane.utils.workflow_sync import (
    SchemeError,
    apply_scheme,
    detach_scheme,
    mapping_needs,
    projects_using,
    validate_scheme,
)
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


class SeedError(Exception):
    def __init__(self, body):
        super().__init__("seed")
        self.body = body


def _seed(workflow, graph, actor_id):
    """Check a server-built graph like a client payload, then save it (X1)."""
    serializer = WorkflowGraphInputSerializer(data=graph, context={"workspace_id": workflow.workspace_id})
    if not serializer.is_valid():
        raise SeedError(serializer.errors)
    save_workflow_graph(workflow=workflow, graph=serializer.validated_data, actor_id=actor_id)


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


class WorkflowStatusCandidatesEndpoint(BaseAPIView):
    # Admins only: the names come from every project of the workspace, private ones included (R15).
    @allow_permission(allowed_roles=[ROLE.ADMIN], level="WORKSPACE")
    def get(self, request, slug):
        workspace = Workspace.objects.get(slug=slug)
        return Response(candidate_statuses(workspace.id), status=status.HTTP_200_OK)


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
        source = None
        source_id = request.data.get("source_project_id") if isinstance(request.data, dict) else None
        if source_id is not None:
            try:
                source_id = StrictUUIDField().run_validation(source_id)
            except serializers.ValidationError as error:
                return Response({"source_project_id": error.detail}, status=status.HTTP_400_BAD_REQUEST)
            # A project of another workspace raises DoesNotExist: same 404 as a missing one (A5).
            source = Project.objects.get(workspace_id=workspace.id, pk=source_id)
        try:
            with transaction.atomic():
                workflow = serializer.save(workspace_id=workspace.id)
                snapshot = _workflow_snapshot(workflow)
                if source is not None:
                    snapshot["source_project_id"] = str(source.id)
                record_audit(
                    workspace_id=workspace.id,
                    actor_id=request.user.id,
                    action="workflow.created",
                    target_type="workflow",
                    target_id=workflow.id,
                    after=snapshot,
                )
                if source is not None:
                    _seed(workflow, graph_from_project(source), request.user.id)
        except SeedError as error:
            return Response(error.body, status=status.HTTP_400_BAD_REQUEST)
        except GraphError as error:
            return Response({"graph": [error.code]}, status=status.HTTP_400_BAD_REQUEST)
        except IntegrityError as error:
            if _constraint_name(error) == STATUS_NAME_CONSTRAINT:
                return Response({"graph": ["duplicate_status_name"]}, status=status.HTTP_400_BAD_REQUEST)
            if _constraint_name(error) != WORKFLOW_NAME_CONSTRAINT:
                raise
            return Response({"name": [DUPLICATE_WORKFLOW_NAME_MESSAGE]}, status=status.HTTP_400_BAD_REQUEST)
        workflow.refresh_from_db()
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


class WorkflowDuplicateEndpoint(BaseAPIView):
    @allow_permission(allowed_roles=[ROLE.ADMIN], level="WORKSPACE")
    def post(self, request, slug, pk):
        if not isinstance(request.data, dict):
            return Response(NOT_AN_OBJECT, status=status.HTTP_400_BAD_REQUEST)
        workspace = Workspace.objects.get(slug=slug)
        source = Workflow.objects.get(workspace_id=workspace.id, pk=pk)
        serializer = WorkflowSerializer(
            data={"name": request.data.get("name"), "description": source.description},
            context={"workspace_id": workspace.id},
        )
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        try:
            with transaction.atomic():
                # Same lock as the graph save: the copy never reads a half-saved source.
                source = Workflow.objects.select_for_update(of=("self",)).get(workspace_id=workspace.id, pk=pk)
                copy = serializer.save(workspace_id=workspace.id)
                record_audit(
                    workspace_id=workspace.id,
                    actor_id=request.user.id,
                    action="workflow.duplicated",
                    target_type="workflow",
                    target_id=copy.id,
                    after={**_workflow_snapshot(copy), "source_workflow_id": str(source.id)},
                )
                # Rows already validated in this workspace: saved as they are (X2).
                save_workflow_graph(workflow=copy, graph=graph_copy(source), actor_id=request.user.id)
        except GraphError as error:
            return Response({"graph": [error.code]}, status=status.HTTP_400_BAD_REQUEST)
        except IntegrityError as error:
            if _constraint_name(error) != WORKFLOW_NAME_CONSTRAINT:
                raise
            return Response({"name": [DUPLICATE_WORKFLOW_NAME_MESSAGE]}, status=status.HTTP_400_BAD_REQUEST)
        copy.refresh_from_db()
        return Response(workflow_detail(copy, True), status=status.HTTP_201_CREATED)


def _writable_project(slug, project_id):
    return Project.objects.get(workspace__slug=slug, pk=project_id, archived_at__isnull=True)


def _scheme_input(request):
    if not isinstance(request.data, dict):
        return None, Response(NOT_AN_OBJECT, status=status.HTTP_400_BAD_REQUEST)
    serializer = ProjectWorkflowSchemeInputSerializer(data=request.data)
    if not serializer.is_valid():
        return None, Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    data = serializer.validated_data
    items = {item["issue_type_id"]: item["workflow_id"] for item in data["items"]}
    mappings = {(mapping["state_id"], mapping["workflow_id"]): mapping["status_id"] for mapping in data["mappings"]}
    return (data["default_workflow_id"], items, mappings), None


def _scheme_refusal(error):
    body = {"scheme": [error.code]}
    if error.details:
        body["needs"] = error.details
    return Response(body, status=status.HTTP_400_BAD_REQUEST)


def scheme_body(project):
    scheme = ProjectWorkflowScheme.objects.filter(project_id=project.id).first()
    if scheme is None:
        return {"default_workflow_id": None, "items": [], "workflows": []}
    items = list(scheme.items.order_by("created_at").values_list("issue_type_id", "workflow_id"))
    workflow_ids = {scheme.default_workflow_id, *(workflow_id for _, workflow_id in items)}
    return {
        "default_workflow_id": str(scheme.default_workflow_id),
        "items": [{"issue_type_id": str(type_id), "workflow_id": str(workflow_id)} for type_id, workflow_id in items],
        # Embedded so the web app computes reachable states without another round trip (P10).
        "workflows": [
            workflow_graph(workflow) for workflow in Workflow.objects.filter(pk__in=workflow_ids).order_by("name")
        ],
    }


class ProjectWorkflowSchemeEndpoint(BaseAPIView):
    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def get(self, request, slug, project_id):
        project = Project.objects.get(workspace__slug=slug, pk=project_id)
        return Response(scheme_body(project), status=status.HTTP_200_OK)

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def put(self, request, slug, project_id):
        refusal = _require_project_manager(request, slug, project_id)
        if refusal:
            return refusal
        scheme_input, error_response = _scheme_input(request)
        if error_response:
            return error_response
        default_workflow_id, items, mappings = scheme_input
        project = _writable_project(slug, project_id)
        try:
            apply_scheme(
                project=project,
                default_workflow_id=default_workflow_id,
                items=items,
                mappings=mappings,
                actor_id=request.user.id,
            )
        except SchemeError as error:
            return _scheme_refusal(error)
        return Response(scheme_body(project), status=status.HTTP_200_OK)

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def delete(self, request, slug, project_id):
        refusal = _require_project_manager(request, slug, project_id)
        if refusal:
            return refusal
        detach_scheme(project=_writable_project(slug, project_id), actor_id=request.user.id)
        return Response(status=status.HTTP_204_NO_CONTENT)


class ProjectWorkflowSchemePreviewEndpoint(BaseAPIView):
    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def post(self, request, slug, project_id):
        refusal = _require_project_manager(request, slug, project_id)
        if refusal:
            return refusal
        scheme_input, error_response = _scheme_input(request)
        if error_response:
            return error_response
        default_workflow_id, items, _ = scheme_input
        project = _writable_project(slug, project_id)
        try:
            validate_scheme(project, default_workflow_id, items)
        except SchemeError as error:
            return _scheme_refusal(error)
        return Response({"needs": mapping_needs(project, default_workflow_id, items)}, status=status.HTTP_200_OK)
