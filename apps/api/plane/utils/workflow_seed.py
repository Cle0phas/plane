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
COLOR_PATTERN = re.compile(r"^#[0-9a-fA-F]{6}$")


def status_color(value):
    # Project states accept any text as a colour; statuses only take #RRGGBB (X3).
    return value if COLOR_PATTERN.match(value or "") else DEFAULT_STATUS_COLOR


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
