# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import pytest
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from plane.db.models import Issue, IssueType, Project, ProjectIssueType, ProjectMember
from plane.tests.factories import IssueTypeFactory


@pytest.fixture
def board(db, workspace, create_user):
    project = Project.objects.create(name="Home", identifier="HOME", workspace=workspace, created_by=create_user)
    ProjectMember.objects.create(project=project, member=create_user, role=20)
    bug = IssueTypeFactory(workspace=workspace, name="Bug")
    ProjectIssueType.objects.create(project=project, issue_type=bug)
    plain = Issue.objects.create(name="Plain", project=project)
    defect = Issue.objects.create(name="Defect", project=project, type=bug)
    client = APIClient()
    client.force_authenticate(user=create_user)
    url = f"/api/workspaces/{workspace.slug}/projects/{project.id}/issues/"
    return client, url, bug, plain, defect, IssueType.objects.get(workspace=workspace, is_default=True)


@pytest.mark.contract
@pytest.mark.django_db
def test_work_items_are_grouped_by_type(board):
    client, url, bug, plain, defect, default_type = board

    response = client.get(url, {"group_by": "type_id"})

    assert response.status_code == status.HTTP_200_OK, response.data
    groups = response.data["results"]
    assert [str(row["id"]) for row in groups[str(bug.id)]["results"]] == [str(defect.id)]
    assert [str(row["id"]) for row in groups[str(default_type.id)]["results"]] == [str(plain.id)]


@pytest.mark.contract
@pytest.mark.django_db
def test_work_items_are_filtered_by_type(board):
    client, url, bug, plain, defect, default_type = board

    response = client.get(url, {"issue_type": str(bug.id)})

    assert response.status_code == status.HTTP_200_OK, response.data
    assert [str(row["id"]) for row in response.data["results"]] == [str(defect.id)]


@pytest.mark.contract
@pytest.mark.django_db
def test_untyped_and_soft_deleted_type_items_stay_in_groups(board):
    client, url, bug, plain, defect, default_type = board
    Issue.objects.filter(pk=plain.pk).update(type=None)
    IssueType.objects.filter(pk=bug.pk).update(deleted_at=timezone.now())

    response = client.get(url, {"group_by": "type_id"})

    assert response.status_code == status.HTTP_200_OK, response.data
    groups = response.data["results"]
    assert [str(row["id"]) for row in groups["None"]["results"]] == [str(plain.id)]
    assert [str(row["id"]) for row in groups[str(bug.id)]["results"]] == [str(defect.id)]
