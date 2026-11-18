# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import pytest

from plane.db.models import Profile
from plane.tests.factories import UserFactory


@pytest.mark.unit
@pytest.mark.django_db
def test_a_new_account_reads_french_by_default():
    profile = Profile.objects.create(user=UserFactory())
    assert profile.language == "fr"
