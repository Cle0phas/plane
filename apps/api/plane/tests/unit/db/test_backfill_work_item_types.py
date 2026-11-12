# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from importlib import import_module

import pytest
from django.apps import apps as django_apps
from django.db import connection
from django.db.migrations.loader import MigrationLoader
from django.db.models.query import QuerySet
from django.test import override_settings
from django.utils import timezone

from plane.db.models import Issue, IssueType, Project, ProjectIssueType
from plane.tests.factories import IssueTypeFactory

backfill = import_module("plane.db.migrations.0127_backfill_work_item_types")

pytestmark = [pytest.mark.unit, pytest.mark.django_db]


@pytest.fixture
def legacy_project(workspace, create_user):
    project = Project.objects.create(name="Legacy", identifier="LEG", workspace=workspace, created_by=create_user)
    # Simulates data created before this feature: no type anywhere.
    IssueType.all_objects.filter(workspace=workspace).delete()
    Issue.objects.create(name="Old 1", project=project)
    Issue.objects.create(name="Old 2", project=project)
    Issue.objects.create(name="Old 3", project=project)
    return project


def test_backfill_restores_the_invariants(workspace, legacy_project):
    assert Issue.objects.filter(project=legacy_project, type__isnull=True).count() == 3

    backfill.backfill_work_item_types(django_apps, None)

    default = IssueType.objects.get(workspace=workspace, is_default=True)
    assert default.name == "Tâche" and default.is_active
    link = ProjectIssueType.objects.get(project=legacy_project, is_default=True)
    assert link.issue_type_id == default.id
    assert not Issue.objects.filter(project=legacy_project, type__isnull=True).exists()


def test_backfill_is_idempotent(workspace, legacy_project):
    backfill.backfill_work_item_types(django_apps, None)
    counts = (IssueType.objects.count(), ProjectIssueType.objects.count())

    backfill.backfill_work_item_types(django_apps, None)

    assert (IssueType.objects.count(), ProjectIssueType.objects.count()) == counts


def test_backfill_updates_work_items_in_batches(workspace, legacy_project, monkeypatch):
    for index in range(4, 6):
        Issue.objects.create(name=f"Old {index}", project=legacy_project)  # 5 untyped work items
    monkeypatch.setattr(backfill, "BATCH_SIZE", 2)
    batch_sizes = []
    original_update = QuerySet.update

    def spy(queryset, **kwargs):
        if queryset.model is Issue and "type_id" in kwargs:
            batch_sizes.append(queryset.count())
        return original_update(queryset, **kwargs)

    monkeypatch.setattr(QuerySet, "update", spy)

    backfill.backfill_work_item_types(django_apps, None)

    assert batch_sizes == [2, 2, 1]
    assert not Issue.objects.filter(project=legacy_project, type__isnull=True).exists()


def test_backfill_keeps_an_existing_project_default(workspace, create_user):
    project = Project.objects.create(name="Kept", identifier="KPT", workspace=workspace, created_by=create_user)
    bug = IssueTypeFactory(workspace=workspace, name="Bug")
    ProjectIssueType.objects.filter(project=project).update(is_default=False)
    ProjectIssueType.objects.create(project=project, issue_type=bug, is_default=True)

    backfill.backfill_work_item_types(django_apps, None)

    assert ProjectIssueType.objects.get(project=project, is_default=True).issue_type_id == bug.id


def test_backfill_repairs_partially_migrated_data(workspace, create_user):
    project = Project.objects.create(name="Half", identifier="HLF", workspace=workspace, created_by=create_user)
    default = IssueType.objects.get(workspace=workspace, is_default=True)
    bug = IssueTypeFactory(workspace=workspace, name="Bug")
    typed = Issue.objects.create(name="Typed", project=project)
    Issue.objects.filter(pk=typed.pk).update(type=bug)
    untyped = Issue.objects.create(name="Untyped", project=project)
    Issue.objects.filter(pk=untyped.pk).update(type=None)
    counts = (IssueType.objects.count(), ProjectIssueType.objects.count())

    backfill.backfill_work_item_types(django_apps, None)

    assert (IssueType.objects.count(), ProjectIssueType.objects.count()) == counts
    assert Issue.objects.get(pk=untyped.pk).type_id == default.id
    assert Issue.objects.get(pk=typed.pk).type_id == bug.id
    assert ProjectIssueType.objects.get(project=project, is_default=True).issue_type_id == default.id


@pytest.fixture
def frozen_apps():
    # Models as they were at 0126: no signals, no save guard, as in a real migration run.
    # The suite runs with --nomigrations, so the real migration graph is restored for this loader only.
    with override_settings(MIGRATION_MODULES={}):
        return MigrationLoader(None).project_state(("db", "0126_auditlog")).apps


def _drop_default_constraints():
    with connection.cursor() as cursor:
        cursor.execute("DROP INDEX issue_type_unique_default_workspace_when_deleted_at_null")
        cursor.execute("DROP INDEX project_issue_type_unique_default_project_when_deleted_at_null")


def _restore_default_constraints():
    with connection.cursor() as cursor:
        cursor.execute("SET CONSTRAINTS ALL IMMEDIATE")
    with connection.schema_editor() as editor:
        for model in (IssueType, ProjectIssueType):
            for constraint in model._meta.constraints:
                if "default" in constraint.name:
                    editor.add_constraint(model, constraint)


def test_backfill_normalises_duplicate_defaults_so_the_constraints_can_be_added(workspace, create_user, frozen_apps):
    project = Project.objects.create(name="Dup", identifier="DUP", workspace=workspace, created_by=create_user)
    _drop_default_constraints()
    first_type = IssueType.objects.get(workspace=workspace, is_default=True)
    second_type = IssueTypeFactory(workspace=workspace, name="Second default", is_default=True)
    ProjectIssueType.objects.create(project=project, issue_type=second_type, is_default=True)

    backfill.backfill_work_item_types(frozen_apps, None)

    assert list(IssueType.objects.filter(workspace=workspace, is_default=True)) == [first_type]
    link = ProjectIssueType.objects.get(project=project, is_default=True)
    assert link.issue_type_id == first_type.id
    _restore_default_constraints()


def test_backfill_skips_soft_deleted_projects_and_workspaces(workspace, create_user, frozen_apps):
    deleted_project = Project.objects.create(name="Gone", identifier="GON", workspace=workspace, created_by=create_user)
    Issue.objects.filter(project=deleted_project).delete()
    item = Issue.objects.create(name="Orphan", project=deleted_project)
    Issue.objects.filter(pk=item.pk).update(type=None)
    Project.objects.filter(pk=deleted_project.pk).update(deleted_at=timezone.now())
    from plane.db.models import Workspace

    dead_workspace = Workspace.objects.create(name="Dead", slug="dead-workspace", owner=create_user)
    dead_project = Project.objects.create(
        name="InDead", identifier="DED", workspace=dead_workspace, created_by=create_user
    )
    IssueType.all_objects.filter(workspace=dead_workspace).delete()
    ProjectIssueType.all_objects.filter(project=dead_project).delete()
    Workspace.objects.filter(pk=dead_workspace.pk).update(deleted_at=timezone.now())

    backfill.backfill_work_item_types(frozen_apps, None)

    assert Issue.objects.get(pk=item.pk).type_id is None
    assert not IssueType.all_objects.filter(workspace=dead_workspace).exists()
    assert not ProjectIssueType.all_objects.filter(project=dead_project).exists()
