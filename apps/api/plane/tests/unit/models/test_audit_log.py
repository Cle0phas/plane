# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from uuid import uuid4

import pytest

from plane.db.models import AuditLog
from plane.utils.audit import record_audit

pytestmark = [pytest.mark.unit, pytest.mark.django_db]


def _entry(workspace, user):
    return record_audit(
        workspace_id=workspace.id,
        actor_id=user.id,
        action="issue_type.created",
        target_type="issue_type",
        target_id=uuid4(),
        after={"name": "Bug"},
    )


def test_record_audit_appends_an_entry(workspace, create_user):
    entry = _entry(workspace, create_user)
    stored = AuditLog.objects.get(pk=entry.pk)
    assert stored.workspace_id == workspace.id
    assert stored.actor_id == create_user.id
    assert stored.action == "issue_type.created"
    assert stored.target_type == "issue_type"
    assert stored.target_id == entry.target_id
    assert stored.before is None
    assert stored.after == {"name": "Bug"}
    assert stored.created_at is not None


def test_audit_entry_cannot_be_updated(workspace, create_user):
    entry = _entry(workspace, create_user)
    entry.action = "issue_type.tampered"
    with pytest.raises(ValueError):
        entry.save()
    assert AuditLog.objects.get(pk=entry.pk).action == "issue_type.created"


def test_audit_entry_cannot_be_deleted(workspace, create_user):
    entry = _entry(workspace, create_user)
    with pytest.raises(ValueError):
        entry.delete()
    assert AuditLog.objects.filter(pk=entry.pk).exists()


def test_audit_queryset_refuses_bulk_update_and_delete(workspace, create_user):
    entry = _entry(workspace, create_user)
    with pytest.raises(ValueError):
        AuditLog.objects.filter(pk=entry.pk).update(action="issue_type.tampered")
    with pytest.raises(ValueError):
        AuditLog.objects.filter(pk=entry.pk).delete()
    with pytest.raises(ValueError):
        AuditLog.objects.all().delete()
    stored = AuditLog.objects.get(pk=entry.pk)
    assert stored.action == "issue_type.created"
