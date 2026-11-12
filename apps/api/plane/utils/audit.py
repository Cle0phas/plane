# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from plane.db.models import AuditLog


def record_audit(*, workspace_id, actor_id, action, target_type, target_id, before=None, after=None):
    """Append one administration event (R12); before and after must be JSON-serialisable."""
    return AuditLog.objects.create(
        workspace_id=workspace_id,
        actor_id=actor_id,
        action=action,
        target_type=target_type,
        target_id=target_id,
        before=before,
        after=after,
    )
