# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Python imports
import uuid

# Django imports
from django.conf import settings
from django.db import models


class AppendOnlyQuerySet(models.QuerySet):
    def update(self, **kwargs):
        raise ValueError("Audit log entries are append-only.")

    def delete(self):
        raise ValueError("Audit log entries are append-only.")


class AuditLog(models.Model):
    """Append-only trail of administration actions; the application never updates or deletes a row."""

    id = models.UUIDField(default=uuid.uuid4, primary_key=True, editable=False)
    # DO_NOTHING without a database constraint keeps the trail when the workspace or the user goes away.
    workspace = models.ForeignKey("db.Workspace", on_delete=models.DO_NOTHING, db_constraint=False, related_name="+")
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.DO_NOTHING, db_constraint=False, related_name="+"
    )
    action = models.CharField(max_length=64)
    target_type = models.CharField(max_length=64)
    target_id = models.UUIDField()
    before = models.JSONField(null=True, blank=True)
    after = models.JSONField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    objects = AppendOnlyQuerySet.as_manager()

    class Meta:
        verbose_name = "Audit Log"
        verbose_name_plural = "Audit Logs"
        db_table = "audit_logs"
        ordering = ("-created_at",)
        indexes = [models.Index(fields=["workspace", "-created_at"], name="audit_log_ws_created_idx")]

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise ValueError("Audit log entries are append-only.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValueError("Audit log entries are append-only.")
