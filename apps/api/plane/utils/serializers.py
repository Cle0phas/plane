# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.


def writable_data(serializer, data):
    """Return ``data`` without the keys that are read-only fields on the bound ``serializer``.

    Read-only fields are ignored on save, so callers use this to keep them out of
    activity and webhook payloads too.
    """
    accepted = {
        key: value for key, value in data.items() if not getattr(serializer.fields.get(key), "read_only", False)
    }
    # A state the workflow set on its own (type change) is a change too, so history and webhooks record it.
    workflow_state_id = getattr(serializer, "workflow_state_id", None)
    if workflow_state_id is not None and serializer.instance is not None:
        accepted["state_id"] = str(workflow_state_id)
    return accepted
