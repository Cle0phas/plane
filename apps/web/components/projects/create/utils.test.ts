/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import { NETWORK_CHOICES } from "@plane/constants";
import { getProjectFormValues } from "./utils";

describe("project visibility", () => {
  it("creates projects secret, the only visibility there is", () => {
    expect(getProjectFormValues().network).toBe(0);
    expect(NETWORK_CHOICES.map((choice) => choice.key)).toEqual([0]);
  });
});
