# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import pytest

from plane.db.models import Workflow, WorkflowState, WorkflowStatus, WorkflowTransition, WorkflowTransitionRule
from plane.db.models.workflow import RULE_RESTRICT_ACTORS
from plane.tests.workflow_builders import build_workflow
from plane.utils.workflow_graph import graph_version, workflow_graph


def _version(workflow):
    return graph_version(workflow_graph(workflow))


@pytest.mark.unit
@pytest.mark.django_db
class TestGraphVersion:
    @pytest.fixture
    def software(self, workspace):
        return build_workflow(workspace, "Software", ["To do", "Done"], [(["To do"], "Done", None)])

    def test_is_a_stable_sha256(self, software):
        first = _version(software)
        assert len(first) == 64
        assert set(first) <= set("0123456789abcdef")
        assert _version(Workflow.objects.get(pk=software.pk)) == first

    def test_ignores_the_name_and_description_of_the_workflow(self, software):
        before = _version(software)
        software.name = "Renamed"
        software.description = "Another description"
        software.save()
        assert _version(software) == before

    def test_changes_with_a_position(self, software):
        before = _version(software)
        state = software.states_by_name["Done"]
        state.position_x = 999
        state.save()
        assert _version(software) != before

    def test_changes_with_the_start_state(self, software):
        before = _version(software)
        WorkflowState.objects.filter(workflow=software).update(is_initial=False)
        assert _version(software) != before

    def test_changes_with_a_transition(self, software):
        before = _version(software)
        WorkflowTransition.objects.create(workflow=software, target=software.states_by_name["To do"], from_any=True)
        assert _version(software) != before

    def test_changes_with_a_rule(self, software):
        before = _version(software)
        WorkflowTransitionRule.objects.create(
            transition=software.transitions.first(), rule_type=RULE_RESTRICT_ACTORS, params={"assignee": True}
        )
        assert _version(software) != before

    def test_changes_when_a_shared_status_is_renamed_from_elsewhere(self, software):
        before = _version(software)
        WorkflowStatus.objects.filter(pk=software.states_by_name["To do"].status_id).update(name="Todo")
        assert _version(software) != before
