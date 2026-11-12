# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from importlib import import_module

import pytest
from django.apps import apps as django_apps
from django.db.models.query import QuerySet

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
