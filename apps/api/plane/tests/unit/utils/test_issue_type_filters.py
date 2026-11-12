# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from uuid import UUID, uuid4

import pytest

from plane.db.models import Issue, IssueType, Project, ProjectIssueType
from plane.tests.factories import IssueTypeFactory, WorkspaceFactory
from plane.utils.filters.filterset import IssueFilterSet
from plane.utils.grouper import issue_group_values
from plane.utils.issue_filters import filter_issue_type, issue_filters


@pytest.mark.unit
class TestFilterIssueType:
    def test_get_keeps_only_valid_uuids(self):
        type_id = uuid4()
        assert filter_issue_type({"issue_type": f"{type_id},not-a-uuid,null"}, {}, "GET") == {"type__in": [type_id]}

    def test_post_accepts_a_list(self):
        type_id = uuid4()
        assert filter_issue_type({"issue_type": [str(type_id), "bad"]}, {}, "POST") == {"type__in": [type_id]}

    def test_empty_value_is_a_no_op(self):
        assert filter_issue_type({"issue_type": ""}, {}, "GET") == {}

    def test_prefix_is_applied(self):
        type_id = uuid4()
        result = filter_issue_type({"issue_type": str(type_id)}, {}, "GET", prefix="issue__")
        assert result == {"issue__type__in": [type_id]}

    def test_registered_in_issue_filters(self):
        type_id = uuid4()
        assert issue_filters({"issue_type": str(type_id)}, "GET") == {"type__in": [type_id]}


@pytest.fixture
def typed_issues(db, workspace, create_user):
    project = Project.objects.create(name="Home", identifier="HOME", workspace=workspace, created_by=create_user)
    bug = IssueTypeFactory(workspace=workspace, name="Bug")
    ProjectIssueType.objects.create(project=project, issue_type=bug)
    Issue.objects.create(name="default item", project=project)
    Issue.objects.create(name="bug item", project=project, type=bug)
    return project, bug


def _names(project, data):
    filterset = IssueFilterSet(data=data, queryset=Issue.objects.filter(project=project))
    assert filterset.is_valid(), filterset.errors
    return set(filterset.qs.values_list("name", flat=True))


@pytest.mark.unit
@pytest.mark.django_db
class TestRichTypeFilter:
    def test_exact(self, typed_issues):
        project, bug = typed_issues
        assert _names(project, {"type_id": str(bug.id)}) == {"bug item"}

    def test_in(self, workspace, typed_issues):
        project, bug = typed_issues
        default_id = IssueType.objects.get(workspace=workspace, is_default=True).id
        assert _names(project, {"type_id__in": f"{bug.id},{default_id}"}) == {"bug item", "default item"}


@pytest.mark.unit
@pytest.mark.django_db
def test_group_values_are_the_workspace_types_including_inactive_ones(workspace, typed_issues):
    project, bug = typed_issues
    IssueType.objects.filter(pk=bug.pk).update(is_active=False)
    IssueTypeFactory(workspace=WorkspaceFactory(), name="Foreign")
    default_id = IssueType.objects.get(workspace=workspace, is_default=True).id

    values = issue_group_values(field="type_id", slug=workspace.slug, project_id=project.id)

    assert "None" in values
    assert {UUID(str(value)) for value in values if value != "None"} == {bug.id, default_id}
