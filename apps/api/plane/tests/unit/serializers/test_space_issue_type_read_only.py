# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import pytest

from plane.space.serializer.issue import IssueCreateSerializer as PublicIssueCreateSerializer


@pytest.mark.unit
def test_public_intake_cannot_choose_the_work_item_type():
    assert PublicIssueCreateSerializer().fields["type"].read_only
