# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.urls import path

from plane.app.views import WorkflowEndpoint, WorkflowGraphEndpoint, WorkflowStatusEndpoint

urlpatterns = [
    path("workspaces/<str:slug>/workflow-statuses/", WorkflowStatusEndpoint.as_view(), name="workflow-statuses"),
    path(
        "workspaces/<str:slug>/workflow-statuses/<uuid:pk>/", WorkflowStatusEndpoint.as_view(), name="workflow-status"
    ),
    path("workspaces/<str:slug>/workflows/", WorkflowEndpoint.as_view(), name="workflows"),
    path("workspaces/<str:slug>/workflows/<uuid:pk>/", WorkflowEndpoint.as_view(), name="workflow"),
    path("workspaces/<str:slug>/workflows/<uuid:pk>/graph/", WorkflowGraphEndpoint.as_view(), name="workflow-graph"),
]
