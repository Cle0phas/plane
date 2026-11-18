# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import importlib

import pytest
from django.db import connection

from plane.db.models import ProjectUserProperty
from plane.db.models.cycle import get_default_display_filters as cycle_defaults
from plane.db.models.issue import get_default_display_filters as project_defaults
from plane.db.models.module import get_default_display_filters as module_defaults
from plane.db.models.view import get_default_display_filters as view_defaults
from plane.tests.factories import ProjectFactory, UserFactory

migration = importlib.import_module("plane.db.migrations.0135_default_kanban_layout")


@pytest.mark.unit
@pytest.mark.parametrize("defaults", [project_defaults, cycle_defaults, module_defaults, view_defaults])
def test_work_items_open_on_a_kanban_grouped_by_state_by_default(defaults):
    display_filters = defaults()
    assert display_filters["layout"] == "kanban"
    assert display_filters["group_by"] == "state"


def _stored_display_filters(display_filters):
    project = ProjectFactory()
    prop = ProjectUserProperty.objects.create(
        project=project, workspace=project.workspace, user=UserFactory(), display_filters=display_filters
    )
    with connection.cursor() as cursor:
        cursor.execute(migration.SWITCH_LIST_TO_KANBAN.format(table="project_user_properties"))
    prop.refresh_from_db()
    return prop.display_filters


@pytest.mark.unit
@pytest.mark.django_db
def test_migration_moves_an_ungrouped_list_to_a_kanban_by_state():
    stored = _stored_display_filters(
        {"layout": "list", "group_by": None, "sub_group_by": "state", "order_by": "-created_at"}
    )
    assert stored == {"layout": "kanban", "group_by": "state", "sub_group_by": None, "order_by": "-created_at"}


@pytest.mark.unit
@pytest.mark.django_db
def test_migration_keeps_the_grouping_of_a_grouped_list():
    stored = _stored_display_filters({"layout": "list", "group_by": "priority", "sub_group_by": None})
    assert stored == {"layout": "kanban", "group_by": "priority", "sub_group_by": None}


@pytest.mark.unit
@pytest.mark.django_db
def test_migration_leaves_other_layouts_alone():
    stored = _stored_display_filters({"layout": "calendar", "group_by": None})
    assert stored == {"layout": "calendar", "group_by": None}
