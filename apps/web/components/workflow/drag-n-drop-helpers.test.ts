/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import { isWorkflowDropForbidden } from "./drag-n-drop-helpers";

const allowed = new Set(["s-todo", "s-doing"]);

describe("isWorkflowDropForbidden", () => {
  it("checks the state column when grouped by state", () => {
    expect(isWorkflowDropForbidden({ groupBy: "state", destinationGroupId: "s-done", allowed })).toBe(true);
    expect(isWorkflowDropForbidden({ groupBy: "state", destinationGroupId: "s-doing", allowed })).toBe(false);
  });

  it("checks the state sub-group too", () => {
    expect(
      isWorkflowDropForbidden({
        groupBy: "priority",
        subGroupBy: "state",
        destinationGroupId: "high",
        destinationSubGroupId: "s-done",
        allowed,
      })
    ).toBe(true);
  });

  it("never blocks a free project or a layout not grouped by state", () => {
    expect(isWorkflowDropForbidden({ groupBy: "state", destinationGroupId: "s-done", allowed: null })).toBe(false);
    expect(isWorkflowDropForbidden({ groupBy: "priority", destinationGroupId: "high", allowed })).toBe(false);
  });
});
