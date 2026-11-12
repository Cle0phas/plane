# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import pytest
from crum import set_current_user
from rest_framework import serializers

from plane.db.models import (
    Issue,
    IssueAssignee,
    IssueType,
    Project,
    ProjectMember,
    ProjectWorkflowScheme,
    ProjectWorkflowSchemeItem,
    State,
    WorkspaceMember,
)
from plane.tests.factories import IssueTypeFactory, ProjectIssueTypeFactory, UserFactory
from plane.tests.workflow_builders import build_workflow
from plane.utils.workflows import (
    ARRIVAL_STATE_REQUIRED,
    TRANSITION_NOT_ALLOWED,
    check_transition,
    initial_state,
    resolve_workflow_state,
    workflow_id_for,
)

pytestmark = [pytest.mark.unit, pytest.mark.django_db]


@pytest.fixture
def users(workspace, create_user):
    people = {"admin": create_user}
    for name, role in (("member", 15), ("guest", 5), ("other_member", 15), ("outside_admin", 20)):
        people[name] = UserFactory()
        WorkspaceMember.objects.create(workspace=workspace, member=people[name], role=role)
    return people


@pytest.fixture
def project(workspace, users):
    project = Project.objects.create(name="Home", identifier="HOME", workspace=workspace, created_by=users["admin"])
    for name, role in (("admin", 20), ("member", 15), ("guest", 5), ("other_member", 15)):
        ProjectMember.objects.create(project=project, member=users[name], role=role)
    return project


@pytest.fixture
def software(workspace):
    return build_workflow(
        workspace,
        "Software",
        ["To do", "Doing", "Done", "Cancelled"],
        [
            (["To do"], "Doing", None),
            (["Doing"], "Done", {"roles": [20]}),
            ("*", "Cancelled", None),
        ],
    )


@pytest.fixture
def support(workspace):
    return build_workflow(workspace, "Support", ["New", "Doing", "Closed"], [(["New"], "Doing", None)])


@pytest.fixture
def bug(workspace, project):
    bug = IssueTypeFactory(workspace=workspace, name="Bug")
    ProjectIssueTypeFactory(project=project, issue_type=bug)
    return bug


def _link(project, default_workflow, items=None):
    """Attach a scheme and one project state per status, as Task 3's service will do."""
    scheme = ProjectWorkflowScheme.objects.create(project=project, workspace=project.workspace, default_workflow=default_workflow)
    for issue_type, workflow in (items or {}).items():
        ProjectWorkflowSchemeItem.objects.create(scheme=scheme, issue_type=issue_type, workflow=workflow)
    for workflow in [default_workflow, *(items or {}).values()]:
        for name, workflow_state in workflow.states_by_name.items():
            State.objects.get_or_create(
                project=project, workflow_status=workflow_state.status, defaults={"name": name, "color": "#3A3A3A"}
            )
    return {state.name: state for state in State.objects.filter(project=project)}


def _issue(project, state, creator=None, **kwargs):
    # BaseModel.save overwrites created_by from the request user unless created_by_id is passed.
    issue = Issue(name="Item", project=project, state=state, **kwargs)
    issue.save(created_by_id=creator.id if creator else None)
    return issue


def _code(error):
    return error.value.detail["workflow"][0]


class TestResolution:
    def test_a_project_without_scheme_has_no_workflow(self, project):
        assert workflow_id_for(project.id, None) is None

    def test_types_without_a_line_follow_the_default_workflow(self, project, software, support, bug):
        _link(project, software, {bug: support})
        default_type_id = IssueType.objects.get(workspace=project.workspace, is_default=True).id
        assert workflow_id_for(project.id, default_type_id) == software.id
        assert workflow_id_for(project.id, None) == software.id
        assert workflow_id_for(project.id, bug.id) == support.id

    def test_initial_state_is_the_project_state_of_the_initial_status(self, project, software):
        states = _link(project, software)
        assert initial_state(project.id, software.id) == states["To do"]


class TestCheckTransition:
    def test_a_free_project_allows_everything(self, project, users):
        a = State.objects.create(name="A", project=project)
        b = State.objects.create(name="B", project=project)
        assert check_transition(_issue(project, a), a, b, users["guest"]) is True

    def test_an_arrow_allows_and_its_absence_refuses(self, project, software, users):
        states = _link(project, software)
        issue = _issue(project, states["To do"])
        assert check_transition(issue, states["To do"], states["Doing"], users["member"]) is True
        assert check_transition(issue, states["To do"], states["Done"], users["member"]) is False

    def test_a_global_transition_comes_from_any_state(self, project, software, users):
        states = _link(project, software)
        issue = _issue(project, states["Doing"])
        assert check_transition(issue, states["Doing"], states["Cancelled"], users["guest"]) is True

    def test_a_state_outside_the_workflow_is_refused(self, project, software, users):
        states = _link(project, software)
        stray = State.objects.create(name="Stray", project=project)
        assert check_transition(_issue(project, states["To do"]), states["To do"], stray, users["admin"]) is False

    def test_staying_in_the_same_state_is_not_a_transition(self, project, software, users):
        states = _link(project, software)
        assert check_transition(_issue(project, states["Done"]), states["Done"], states["Done"], users["guest"]) is True

    def test_from_triage_only_global_transitions_apply(self, project, software, users):
        states = _link(project, software)
        triage = State.objects.create(name="Triage", project=project, group="triage")
        issue = _issue(project, triage)
        assert check_transition(issue, triage, states["Doing"], users["admin"]) is False
        assert check_transition(issue, triage, states["Cancelled"], users["admin"]) is True


class TestRestrictActors:
    @pytest.fixture
    def states(self, project, workspace):
        workflow = build_workflow(
            workspace,
            "Guarded",
            ["Open", "Roles", "Named", "Assignee", "Creator", "Mixed"],
            [
                (["Open"], "Roles", {"roles": [15, 20]}),
                (["Open"], "Named", {"user_ids": []}),
                (["Open"], "Assignee", {"assignee": True}),
                (["Open"], "Creator", {"creator": True}),
                (["Open"], "Mixed", {"roles": [20], "creator": True}),
            ],
        )
        return _link(project, workflow)

    def test_roles(self, project, states, users):
        issue = _issue(project, states["Open"])
        assert check_transition(issue, states["Open"], states["Roles"], users["member"]) is True
        assert check_transition(issue, states["Open"], states["Roles"], users["guest"]) is False

    def test_workspace_admins_outside_the_rule_are_not_exempt(self, project, states, users):
        issue = _issue(project, states["Open"])
        assert check_transition(issue, states["Open"], states["Roles"], users["outside_admin"]) is False

    def test_named_users(self, project, states, users):
        from plane.db.models import WorkflowTransitionRule

        WorkflowTransitionRule.objects.filter(transition__target__status__name="Named").update(
            params={"user_ids": [str(users["guest"].id)]}
        )
        issue = _issue(project, states["Open"])
        assert check_transition(issue, states["Open"], states["Named"], users["guest"]) is True
        assert check_transition(issue, states["Open"], states["Named"], users["member"]) is False

    def test_assignee(self, project, states, users):
        issue = _issue(project, states["Open"])
        IssueAssignee.objects.create(issue=issue, assignee=users["guest"], project=project)
        assert check_transition(issue, states["Open"], states["Assignee"], users["guest"]) is True
        assert check_transition(issue, states["Open"], states["Assignee"], users["member"]) is False

    def test_creator(self, project, states, users):
        issue = _issue(project, states["Open"], creator=users["other_member"])
        assert check_transition(issue, states["Open"], states["Creator"], users["other_member"]) is True
        assert check_transition(issue, states["Open"], states["Creator"], users["member"]) is False

    def test_criteria_combine_with_or(self, project, states, users):
        issue = _issue(project, states["Open"], creator=users["guest"])
        assert check_transition(issue, states["Open"], states["Mixed"], users["guest"]) is True
        assert check_transition(issue, states["Open"], states["Mixed"], users["admin"]) is True
        assert check_transition(issue, states["Open"], states["Mixed"], users["member"]) is False

    def test_without_actor_a_rule_refuses(self, project, states):
        issue = _issue(project, states["Open"])
        assert check_transition(issue, states["Open"], states["Roles"], None) is False


class TestResolveWorkflowState:
    @pytest.fixture(autouse=True)
    def actor(self, users):
        set_current_user(users["member"])
        yield
        set_current_user(None)

    def test_creation_without_state_takes_the_initial_state(self, project, software):
        states = _link(project, software)
        resolved = resolve_workflow_state(project_id=project.id, instance=None, state=None, state_given=False, type_id=None)
        assert resolved == states["To do"]

    def test_creation_in_another_state_is_refused(self, project, software):
        states = _link(project, software)
        with pytest.raises(serializers.ValidationError) as error:
            resolve_workflow_state(project_id=project.id, instance=None, state=states["Doing"], state_given=True, type_id=None)
        assert _code(error) == TRANSITION_NOT_ALLOWED

    def test_creation_uses_the_workflow_of_the_requested_type(self, project, software, support, bug):
        states = _link(project, software, {bug: support})
        resolved = resolve_workflow_state(project_id=project.id, instance=None, state=None, state_given=False, type_id=bug.id)
        assert resolved == states["New"]

    def test_creation_in_triage_is_left_alone(self, project, software):
        _link(project, software)
        triage = State.objects.create(name="Triage", project=project, group="triage")
        assert resolve_workflow_state(project_id=project.id, instance=None, state=triage, state_given=True, type_id=None) is None

    def test_a_free_project_is_left_alone(self, project):
        state = State.objects.create(name="A", project=project)
        assert resolve_workflow_state(project_id=project.id, instance=None, state=state, state_given=True, type_id=None) is None

    def test_an_allowed_move_passes_and_a_forbidden_one_is_refused(self, project, software):
        states = _link(project, software)
        issue = _issue(project, states["To do"])
        assert (
            resolve_workflow_state(project_id=project.id, instance=issue, state=states["Doing"], state_given=True, type_id=None)
            is None
        )
        with pytest.raises(serializers.ValidationError) as error:
            resolve_workflow_state(project_id=project.id, instance=issue, state=states["Done"], state_given=True, type_id=None)
        assert _code(error) == TRANSITION_NOT_ALLOWED

    def test_clearing_the_state_is_refused(self, project, software):
        states = _link(project, software)
        issue = _issue(project, states["To do"])
        with pytest.raises(serializers.ValidationError) as error:
            resolve_workflow_state(project_id=project.id, instance=issue, state=None, state_given=True, type_id=None)
        assert _code(error) == TRANSITION_NOT_ALLOWED

    def test_type_change_keeps_a_state_present_in_the_new_workflow(self, project, software, support, bug):
        states = _link(project, software, {bug: support})
        issue = _issue(project, states["Doing"])
        assert resolve_workflow_state(project_id=project.id, instance=issue, state=None, state_given=False, type_id=bug.id) is None

    def test_type_change_requires_an_arrival_state_otherwise(self, project, software, support, bug):
        states = _link(project, software, {bug: support})
        issue = _issue(project, states["To do"])
        with pytest.raises(serializers.ValidationError) as error:
            resolve_workflow_state(project_id=project.id, instance=issue, state=None, state_given=False, type_id=bug.id)
        assert _code(error) == ARRIVAL_STATE_REQUIRED

    def test_type_change_accepts_any_state_of_the_new_workflow_without_arrow(self, project, software, support, bug):
        states = _link(project, software, {bug: support})
        issue = _issue(project, states["To do"])
        assert (
            resolve_workflow_state(project_id=project.id, instance=issue, state=states["Closed"], state_given=True, type_id=bug.id)
            is None
        )

    def test_type_change_refuses_an_arrival_outside_the_new_workflow(self, project, software, support, bug):
        states = _link(project, software, {bug: support})
        issue = _issue(project, states["To do"])
        with pytest.raises(serializers.ValidationError) as error:
            resolve_workflow_state(project_id=project.id, instance=issue, state=states["Done"], state_given=True, type_id=bug.id)
        assert _code(error) == TRANSITION_NOT_ALLOWED
