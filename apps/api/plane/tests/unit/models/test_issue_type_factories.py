# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import pytest

from plane.db.models import ProjectIssueType
from plane.tests.factories import IssueTypeFactory, ProjectIssueTypeFactory

pytestmark = [pytest.mark.unit, pytest.mark.django_db]


def test_issue_type_factory_creates_active_non_default_type():
    issue_type = IssueTypeFactory()
    assert issue_type.is_active
    assert not issue_type.is_default


def test_project_issue_type_factory_links_a_type_of_the_project_workspace():
    link = ProjectIssueTypeFactory()
    assert link.issue_type.workspace_id == link.project.workspace_id
    assert ProjectIssueType.objects.filter(pk=link.pk).exists()
