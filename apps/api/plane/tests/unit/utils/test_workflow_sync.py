# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import pytest

from plane.db.models import (
    AuditLog,
    Issue,
    Project,
    ProjectWorkflowScheme,
    State,
    WorkflowState,
    WorkflowStatus,
)
from plane.tests.factories import IssueTypeFactory, ProjectIssueTypeFactory, WorkspaceFactory
from plane.tests.workflow_builders import build_workflow, link_project
from plane.utils.workflow_sync import (
    SchemeError,
    apply_scheme,
    deduce_groups,
    detach_scheme,
    mapping_needs,
    propagate_statuses,
    resync_workflow,
    status_usage,
    sync_project_states,
)

pytestmark = [pytest.mark.unit, pytest.mark.django_db]


@pytest.fixture
def project(workspace, create_user):
    return Project.objects.create(name="Home", identifier="HOME", workspace=workspace, created_by=create_user)


@pytest.fixture
def software(workspace):
    return build_workflow(
        workspace, "Software", ["To do", "Doing", "Done"], [(["To do"], "Doing", None), (["Doing"], "Done", None)]
    )


@pytest.fixture
def support(workspace):
    return build_workflow(workspace, "Support", ["New", "To do", "Closed"], [(["New"], "Closed", None)])


@pytest.fixture
def bug(workspace, project):
    bug = IssueTypeFactory(workspace=workspace, name="Bug")
    ProjectIssueTypeFactory(project=project, issue_type=bug)
    return bug


def _apply(project, default_workflow, items=None, mappings=None, actor=None):
    return apply_scheme(
        project=project,
        default_workflow_id=default_workflow.id,
        items={issue_type.id: workflow.id for issue_type, workflow in (items or {}).items()},
        mappings=mappings or {},
        actor_id=(actor.id if actor else project.workspace.owner_id),
    )


class TestSync:
    def test_one_project_state_per_status_even_when_shared(self, project, software, support, bug):
        states = link_project(project, software, {bug: support})
        assert sorted(states) == ["Closed", "Doing", "Done", "New", "To do"]
        assert State.objects.filter(project=project, name="To do").count() == 1
        assert all(state.workflow_status_id is not None for state in states.values())

    def test_the_default_state_is_the_initial_state_of_the_default_workflow(self, project, software, support, bug):
        states = link_project(project, software, {bug: support})
        assert list(State.objects.filter(project=project, default=True)) == [states["To do"]]

    def test_an_unmanaged_state_with_the_same_name_is_reused(self, project, software, create_user):
        legacy = State.objects.create(name="TO DO", project=project, color="#000000")
        issue = Issue.objects.create(name="Item", project=project, state=legacy)
        states = link_project(project, software)
        assert states["To do"].pk == legacy.pk
        issue.refresh_from_db()
        assert issue.state_id == legacy.pk

    def test_status_changes_reach_every_linked_project(self, workspace, project, software, create_user):
        other = Project.objects.create(name="Other", identifier="OTH", workspace=workspace, created_by=create_user)
        link_project(project, software)
        link_project(other, software)
        status = software.states_by_name["Doing"].status
        status.name, status.color, status.group = "In progress", "#00FF00", "started"
        status.save()
        propagate_statuses([status])
        assert State.objects.filter(workflow_status=status, name="In progress", color="#00FF00").count() == 2

    def test_a_status_left_by_every_workflow_of_the_scheme_loses_its_empty_state(self, project, software):
        states = link_project(project, software)
        WorkflowState.objects.filter(pk=software.states_by_name["Done"].pk).delete()
        sync_project_states(project)
        assert not State.objects.filter(pk=states["Done"].pk).exists()


class TestMappingAndApply:
    def test_needs_list_states_absent_from_the_target_workflow(self, project, software, support, bug):
        legacy = State.objects.create(name="Backlog", project=project)
        same_name = State.objects.create(name="Doing", project=project)
        Issue.objects.create(name="Task", project=project, state=legacy)
        Issue.objects.create(name="Bug", project=project, state=same_name, type=bug)
        Issue.objects.create(name="Task 2", project=project, state=same_name)
        triage = State.objects.create(name="Triage", project=project, group="triage")
        Issue.objects.create(name="Intake", project=project, state=triage)

        needs = mapping_needs(project, software.id, {bug.id: support.id})

        simplified = sorted(
            (need["state_name"], need["workflow_id"], need["issue_count"], need["auto_status_id"]) for need in needs
        )
        doing_status_id = str(software.states_by_name["Doing"].status_id)
        assert simplified == sorted(
            [
                ("Backlog", str(software.id), 1, None),
                ("Doing", str(support.id), 1, None),
                ("Doing", str(software.id), 1, doing_status_id),
            ]
        )

    def test_apply_refuses_an_incomplete_mapping(self, project, software):
        legacy = State.objects.create(name="Backlog", project=project)
        Issue.objects.create(name="Task", project=project, state=legacy)
        with pytest.raises(SchemeError) as error:
            _apply(project, software)
        assert error.value.code == "mapping_incomplete"
        assert not ProjectWorkflowScheme.objects.exists()

    def test_apply_refuses_an_arrival_outside_the_target_workflow(self, project, software, support):
        legacy = State.objects.create(name="Backlog", project=project)
        Issue.objects.create(name="Task", project=project, state=legacy)
        with pytest.raises(SchemeError) as error:
            _apply(project, software, mappings={(legacy.id, software.id): support.states_by_name["New"].status_id})
        assert error.value.code == "invalid_mapping"

    def test_apply_moves_items_records_history_and_audit(
        self, project, software, mock_celery, django_capture_on_commit_callbacks
    ):
        legacy = State.objects.create(name="Backlog", project=project)
        issue = Issue.objects.create(name="Task", project=project, state=legacy)
        with django_capture_on_commit_callbacks(execute=True):
            states = _apply(
                project, software, mappings={(legacy.id, software.id): software.states_by_name["Doing"].status_id}
            )
        issue.refresh_from_db()
        assert issue.state_id == states[software.states_by_name["Doing"].status_id].id
        assert not State.objects.filter(pk=legacy.pk).exists()
        assert mock_celery.call_count == 1
        assert mock_celery.call_args.kwargs["issue_id"] == str(issue.id)
        entry = AuditLog.objects.get(action="project_workflow_scheme.applied")
        assert entry.target_id == project.id
        assert entry.after["default_workflow_id"] == str(software.id)
        assert entry.after["moved_issue_count"] == 1

    def test_a_broker_failure_after_commit_does_not_fail_the_apply(
        self, project, software, mock_celery, django_capture_on_commit_callbacks
    ):
        mock_celery.side_effect = ConnectionError("broker down")
        legacy = State.objects.create(name="Backlog", project=project)
        issue = Issue.objects.create(name="Task", project=project, state=legacy)
        with django_capture_on_commit_callbacks(execute=True):
            states = _apply(
                project, software, mappings={(legacy.id, software.id): software.states_by_name["Doing"].status_id}
            )
        issue.refresh_from_db()
        assert issue.state_id == states[software.states_by_name["Doing"].status_id].id
        assert mock_celery.call_count == 1

    def test_applying_twice_changes_nothing_the_second_time(self, project, software, mock_celery):
        _apply(project, software)
        _apply(project, software)
        assert ProjectWorkflowScheme.objects.count() == 1
        assert AuditLog.objects.filter(action="project_workflow_scheme.applied").count() == 1

    def test_apply_refuses_a_foreign_or_empty_workflow_and_a_type_not_enabled(self, workspace, project, software):
        foreign = build_workflow(WorkspaceFactory(), "Foreign", ["A"])
        empty = build_workflow(workspace, "Empty", ["Only"])
        WorkflowState.objects.filter(workflow=empty).delete()
        stranger = IssueTypeFactory(workspace=workspace, name="Stranger")
        for default_workflow, items in ((foreign, {}), (empty, {}), (software, {stranger: software})):
            with pytest.raises(SchemeError) as error:
                _apply(project, default_workflow, items)
            assert error.value.code == "invalid_scheme"

    def test_changing_the_workflow_of_a_type_needs_a_mapping_for_its_items(
        self, project, software, support, bug, mock_celery
    ):
        states = link_project(project, software, {bug: support})
        Issue.objects.create(name="Bug", project=project, state=states["New"], type=bug)
        needs = mapping_needs(project, software.id, {})
        assert [(need["state_name"], need["workflow_id"]) for need in needs] == [("New", str(software.id))]

    def test_a_type_leaving_its_workflow_moves_its_items_and_drops_the_empty_states(
        self, project, software, support, bug, mock_celery, django_capture_on_commit_callbacks
    ):
        states = link_project(project, software, {bug: support})
        issue = Issue.objects.create(name="Bug", project=project, state=states["New"], type=bug)
        mapping = {(states["New"].id, software.id): software.states_by_name["Doing"].status_id}
        with django_capture_on_commit_callbacks(execute=True):
            result = _apply(project, software, mappings=mapping)
        issue.refresh_from_db()
        assert issue.state_id == result[software.states_by_name["Doing"].status_id].id
        assert not State.objects.filter(pk__in=[states["New"].pk, states["Closed"].pk]).exists()
        assert State.all_state_objects.filter(pk=states["New"].pk, deleted_at__isnull=False).exists()
        assert mock_celery.call_count == 1
        entry = AuditLog.objects.filter(action="project_workflow_scheme.applied").latest("created_at")
        assert entry.before["items"] == {str(bug.id): str(support.id)}
        assert entry.after["items"] == {}
        assert entry.after["moved_issue_count"] == 1

    def test_identifiers_are_canonical_so_upper_case_input_is_a_replay(self, project, software, support, bug):
        link_project(project, software, {bug: support})
        apply_scheme(
            project=project,
            default_workflow_id=str(software.id).upper(),
            items={str(bug.id).upper(): str(support.id).upper()},
            mappings={},
            actor_id=project.workspace.owner_id,
        )
        assert AuditLog.objects.filter(action="project_workflow_scheme.applied").count() == 1

    def test_detach_keeps_the_states_and_unlinks_them(self, project, software):
        states = link_project(project, software)
        assert detach_scheme(project=project, actor_id=project.workspace.owner_id) is True
        assert not ProjectWorkflowScheme.objects.exists()
        assert State.objects.filter(pk=states["To do"].pk, workflow_status__isnull=True).exists()
        assert AuditLog.objects.filter(action="project_workflow_scheme.detached", target_id=project.id).exists()
        assert detach_scheme(project=project, actor_id=project.workspace.owner_id) is False


class TestResync:
    def test_resync_works_outside_a_transaction_block(self, project, software):
        link_project(project, software)
        extra = WorkflowStatus.objects.create(workspace=software.workspace, name="Review", color="#3A3A3A")
        WorkflowState.objects.create(workflow=software, status=extra, position_x=900)
        resync_workflow(software.id)
        assert State.objects.filter(project=project, workflow_status=extra).exists()

    def test_resync_skips_a_project_detached_meanwhile(self, project, software, monkeypatch):
        link_project(project, software)
        detach_scheme(project=project, actor_id=project.workspace.owner_id)
        monkeypatch.setattr(
            "plane.utils.workflow_sync.projects_using", lambda workflow_id: Project.objects.filter(pk=project.pk)
        )
        resync_workflow(software.id)


class TestUsageAndGroups:
    def test_usage_counts_only_items_following_the_workflow(self, project, software, support, bug):
        states = link_project(project, software, {bug: support})
        Issue.objects.create(name="Task", project=project, state=states["To do"])
        Issue.objects.create(name="Bug", project=project, state=states["To do"], type=bug)
        usage = status_usage(software.id, [software.states_by_name["To do"].status_id])
        assert usage == [{"project_id": str(project.id), "project_name": "Home", "issue_count": 1}]

    def test_groups_follow_the_graph_and_ignore_global_transitions(self, workspace):
        workflow = build_workflow(
            workspace,
            "Flow",
            ["Open", "Work", "Shipped", "Dropped"],
            [(["Open"], "Work", None), (["Work"], "Shipped", None), ("*", "Dropped", None)],
        )
        deduce_groups(workflow.id)
        groups = {
            name: WorkflowStatus.objects.get(pk=state.status_id).group
            for name, state in workflow.states_by_name.items()
        }
        assert groups == {"Open": "unstarted", "Work": "started", "Shipped": "completed", "Dropped": "completed"}

    def test_a_manual_group_or_a_shared_status_is_left_alone(self, workspace):
        first = build_workflow(workspace, "First", ["Open", "Shared"], [(["Open"], "Shared", None)])
        build_workflow(workspace, "Second", ["Shared", "End"], [(["Shared"], "End", None)])
        WorkflowStatus.objects.filter(name="Open").update(group="backlog", group_is_auto=False)
        deduce_groups(first.id)
        assert WorkflowStatus.objects.get(name="Open").group == "backlog"
        assert WorkflowStatus.objects.get(name="Shared").group == "started"
