# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Django imports
from django.db.models import F

# Third party imports
from rest_framework import serializers

# Module imports
from plane.db.models import IssueType, ProjectIssueType

INVALID_WORK_ITEM_TYPE_MESSAGE = "Work item type is not valid for this project."


class StrictUUIDField(serializers.UUIDField):
    # DRF turns an int into UUID(int=...), so only the string form is accepted.
    def to_internal_value(self, data):
        if not isinstance(data, str):
            self.fail("invalid", value=data)
        return super().to_internal_value(data)


def validate_work_item_type_id(type_id, *, project_id, workspace_id=None, current_type_id=None, allow_null=True):
    """Return type_id when a work item may take it (R7, R9), else raise one message whatever the cause."""
    # Null means "project default" at creation only; on update the model would reset it silently, unlogged (R11).
    if type_id is None and not allow_null:
        raise serializers.ValidationError({"type_id": [INVALID_WORK_ITEM_TYPE_MESSAGE]})
    # Keeping the current type stays allowed so items keep a type deactivated since (R7).
    if type_id is None or type_id == current_type_id:
        return type_id
    if project_id is not None:
        allowed = ProjectIssueType.objects.filter(
            project_id=project_id,
            issue_type_id=type_id,
            issue_type__workspace_id=F("workspace_id"),
            issue_type__is_active=True,
            issue_type__deleted_at__isnull=True,
        ).exists()
    else:
        allowed = IssueType.objects.filter(pk=type_id, workspace_id=workspace_id, is_active=True).exists()
    if not allowed:
        raise serializers.ValidationError({"type_id": [INVALID_WORK_ITEM_TYPE_MESSAGE]})
    return type_id
