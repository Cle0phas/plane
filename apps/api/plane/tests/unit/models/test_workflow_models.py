# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import pytest
from django.db import IntegrityError, transaction

from plane.db.models import (
    Project,
    ProjectWorkflowScheme,
    ProjectWorkflowSchemeItem,
    State,
    Workflow,
    WorkflowState,
    WorkflowStatus,
    WorkflowTransition,
    WorkflowTransitionRule,
    WorkflowTransitionSource,
)
from plane.tests.factories import IssueTypeFactory, WorkflowFactory, WorkflowStatusFactory
from plane.tests.workflow_builders import build_workflow

pytestmark = [pytest.mark.unit, pytest.mark.django_db]


@pytest.fixture
def project(workspace, create_user):
    return Project.objects.create(name="Home", identifier="HOME", workspace=workspace, created_by=create_user)


def test_status_names_are_unique_per_workspace_whatever_the_case(workspace):
    WorkflowStatusFactory(workspace=workspace, name="To do")
    with pytest.raises(IntegrityError), transaction.atomic():
        WorkflowStatusFactory(workspace=workspace, name="TO DO")


def test_a_deleted_status_frees_its_name(workspace):
    WorkflowStatus.objects.filter(pk=WorkflowStatusFactory(workspace=workspace, name="To do").pk).delete()
    assert WorkflowStatusFactory(workspace=workspace, name="To do").name == "To do"


def test_a_status_never_uses_the_triage_group(workspace):
    with pytest.raises(IntegrityError), transaction.atomic():
        WorkflowStatusFactory(workspace=workspace, group="triage")


def test_workflow_names_are_unique_per_workspace_whatever_the_case(workspace):
    WorkflowFactory(workspace=workspace, name="Software")
    with pytest.raises(IntegrityError), transaction.atomic():
        WorkflowFactory(workspace=workspace, name="software")


def test_a_workflow_has_at_most_one_initial_state(workspace):
    workflow = build_workflow(workspace, "Software", ["To do", "Done"])
    with pytest.raises(IntegrityError), transaction.atomic():
        WorkflowState.objects.filter(pk=workflow.states_by_name["Done"].pk).update(is_initial=True)


def test_a_status_appears_once_per_workflow(workspace):
    workflow = build_workflow(workspace, "Software", ["To do"])
    with pytest.raises(IntegrityError), transaction.atomic():
        WorkflowState.objects.create(workflow=workflow, status=workflow.states_by_name["To do"].status)


def test_two_workflows_share_a_status(workspace):
    software = build_workflow(workspace, "Software", ["To do", "Done"])
    support = build_workflow(workspace, "Support", ["To do", "Closed"])
    assert software.states_by_name["To do"].status_id == support.states_by_name["To do"].status_id
    assert WorkflowStatus.objects.filter(workspace=workspace).count() == 3


def test_the_builder_creates_sources_and_rules(workspace):
    workflow = build_workflow(
        workspace,
        "Software",
        ["To do", "Doing", "Done"],
        [(["To do"], "Doing", None), ("*", "Done", {"roles": [20]})],
    )
    local = WorkflowTransition.objects.get(workflow=workflow, target=workflow.states_by_name["Doing"])
    globally = WorkflowTransition.objects.get(workflow=workflow, target=workflow.states_by_name["Done"])
    assert local.from_any is False
    assert list(
        WorkflowTransitionSource.objects.filter(transition=local).values_list("source__status__name", flat=True)
    ) == ["To do"]
    assert globally.from_any is True
    assert WorkflowTransitionRule.objects.get(transition=globally).params == {"roles": [20]}


def test_a_project_state_links_one_status_at_most(workspace, project):
    status = WorkflowStatusFactory(workspace=workspace)
    State.objects.create(name="A", project=project, workflow_status=status)
    with pytest.raises(IntegrityError), transaction.atomic():
        State.objects.create(name="B", project=project, workflow_status=status)


def test_a_project_has_one_scheme_and_one_line_per_type(workspace, project):
    workflow = WorkflowFactory(workspace=workspace)
    scheme = ProjectWorkflowScheme.objects.create(project=project, workspace=workspace, default_workflow=workflow)
    bug = IssueTypeFactory(workspace=workspace)
    ProjectWorkflowSchemeItem.objects.create(scheme=scheme, issue_type=bug, workflow=workflow)
    with pytest.raises(IntegrityError), transaction.atomic():
        ProjectWorkflowScheme.objects.create(project=project, workspace=workspace, default_workflow=workflow)
    with pytest.raises(IntegrityError), transaction.atomic():
        ProjectWorkflowSchemeItem.objects.create(scheme=scheme, issue_type=bug, workflow=workflow)


def test_deleting_a_workflow_row_removes_its_graph(workspace):
    workflow = build_workflow(workspace, "Software", ["To do", "Done"], [(["To do"], "Done", {"creator": True})])
    Workflow.objects.filter(pk=workflow.pk).delete(soft=False)
    assert not WorkflowState.objects.exists()
    assert not WorkflowTransition.objects.exists()
    assert not WorkflowTransitionRule.objects.exists()


class TestTransitionSideConstraint:
    def test_the_database_refuses_a_side_outside_the_four(self, workspace):
        workflow = build_workflow(workspace, "Sides", ["A", "B"], [(["A"], "B", None)])
        source = WorkflowTransitionSource.objects.get(transition__workflow=workflow)
        for field in ("source_side", "target_side"):
            with pytest.raises(IntegrityError), transaction.atomic():
                WorkflowTransitionSource.objects.filter(pk=source.pk).update(**{field: "middle"})
        WorkflowTransitionSource.objects.filter(pk=source.pk).update(source_side="top", target_side="")
