# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import pytest
from django.db import IntegrityError, transaction
from django.utils import timezone

from plane.db.models import IssueType, Project, ProjectIssueType
from plane.tests.factories import IssueTypeFactory

pytestmark = [pytest.mark.unit, pytest.mark.django_db]


def test_type_names_are_unique_per_workspace_ignoring_case(workspace):
    IssueTypeFactory(workspace=workspace, name="Bug")
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            IssueTypeFactory(workspace=workspace, name="bUG")


def test_the_name_of_a_deleted_type_can_be_reused(workspace):
    deleted = IssueTypeFactory(workspace=workspace, name="Bug")
    IssueType.all_objects.filter(pk=deleted.pk).update(deleted_at=timezone.now())
    assert IssueTypeFactory(workspace=workspace, name="Bug").pk != deleted.pk


def test_a_workspace_has_at_most_one_default_type(workspace):
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            IssueTypeFactory(workspace=workspace, name="Second default", is_default=True)


def test_a_project_has_at_most_one_default_type(workspace, create_user):
    project = Project.objects.create(name="P", identifier="P", workspace=workspace, created_by=create_user)
    bug = IssueTypeFactory(workspace=workspace, name="Bug")
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            ProjectIssueType.objects.create(project=project, issue_type=bug, is_default=True)
