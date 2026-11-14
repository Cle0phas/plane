# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Python imports
import re

# Module imports
from plane.db.models import State, WorkflowStatus
from plane.db.models.workflow import RESERVED_STATUS_NAMES

GROUP_ORDER = ["backlog", "unstarted", "started", "completed", "cancelled"]
CANDIDATE_LIMIT = 500
DEFAULT_STATUS_COLOR = "#3A3A3A"
PLACEMENT_STEP = 240
COLOR_PATTERN = re.compile(r"#[0-9a-fA-F]{6}")


def status_color(value):
    # Project states accept any text as a colour; statuses only take #RRGGBB (X3).
    return value if COLOR_PATTERN.fullmatch(value or "") else DEFAULT_STATUS_COLOR


def candidate_statuses(workspace_id):
    """Project state names that are not workspace statuses yet, one entry per name (spec 4.1)."""
    taken = {
        name.lower() for name in WorkflowStatus.objects.filter(workspace_id=workspace_id).values_list("name", flat=True)
    }
    candidates = {}
    # State.objects already leaves out triage and soft-deleted rows.
    states = (
        State.objects.filter(workspace_id=workspace_id, project__deleted_at__isnull=True)
        .order_by("created_at", "id")
        .values_list("name", "color", "group")
    )
    for name, color, group in states:
        key = name.strip().lower()
        if not key or key in taken or key in RESERVED_STATUS_NAMES or key in candidates or group not in GROUP_ORDER:
            continue
        candidates[key] = {"name": name.strip(), "color": status_color(color), "group": group}
    ordered = sorted(candidates.values(), key=lambda item: (GROUP_ORDER.index(item["group"]), item["name"].lower()))
    return ordered[:CANDIDATE_LIMIT]


def _transition(target, sources=None):
    return {
        "name": "",
        "from_any": sources is None,
        "source_keys": [str(state.id) for state in sources or []],
        "target_key": str(target.id),
        "rules": [],
    }


def graph_from_project(project):
    """Graph payload reproducing the states of a project as a chain (spec 5.2)."""
    statuses = {
        status.name.lower(): status for status in WorkflowStatus.objects.filter(workspace_id=project.workspace_id)
    }
    rows, seen = [], set()
    for state in State.objects.filter(project_id=project.id).order_by("sequence", "created_at", "id"):
        key = state.name.strip().lower()
        if not key or key in seen or key in RESERVED_STATUS_NAMES or state.group not in GROUP_ORDER:
            continue
        seen.add(key)
        rows.append(state)
    # Stable sort: the project rank is kept inside a category.
    rows.sort(key=lambda state: GROUP_ORDER.index(state.group))
    live = [state for state in rows if state.group != "cancelled"]
    initial = next((state for state in live if state.default), (live or rows or [None])[0])

    states = []
    for index, state in enumerate(rows):
        existing = statuses.get(state.name.strip().lower())
        if existing is not None:
            status = {"id": str(existing.id), "name": existing.name, "color": existing.color}
        else:
            status = {"name": state.name.strip(), "color": status_color(state.color), "group": state.group}
        states.append(
            {
                "key": str(state.id),
                "status": status,
                "position_x": index * PLACEMENT_STEP,
                "position_y": 0,
                "is_initial": state is initial,
            }
        )
    transitions = [_transition(target, [source]) for source, target in zip(live, live[1:])]
    cancelled = [state for state in rows if state.group == "cancelled" and state is not initial]
    transitions += [_transition(state) for state in ([initial] if initial is not None else []) + cancelled]
    return {"states": states, "transitions": transitions}
