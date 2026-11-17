/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import { isWorkflowCreationDisabled, isWorkflowDropForbidden } from "./drag-n-drop-helpers";

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

describe("isWorkflowCreationDisabled", () => {
  const base = { groupId: "s-doing", initialStateId: "s-todo" };

  it("allows only the initial state column when grouped by state", () => {
    expect(isWorkflowCreationDisabled({ ...base, groupBy: "state" })).toBe(true);
    expect(isWorkflowCreationDisabled({ ...base, groupBy: "state", groupId: "s-todo" })).toBe(false);
  });

  it("checks the state sub-group too", () => {
    expect(
      isWorkflowCreationDisabled({
        ...base,
        groupBy: "priority",
        groupId: "high",
        subGroupBy: "state",
        subGroupId: "s-doing",
      })
    ).toBe(true);
    expect(
      isWorkflowCreationDisabled({
        ...base,
        groupBy: "priority",
        groupId: "high",
        subGroupBy: "state",
        subGroupId: "s-todo",
      })
    ).toBe(false);
  });

  it("never disables a free project or a layout not grouped by state", () => {
    expect(isWorkflowCreationDisabled({ ...base, groupBy: "state", initialStateId: undefined })).toBe(false);
    expect(isWorkflowCreationDisabled({ ...base, groupBy: "priority", groupId: "high" })).toBe(false);
  });
});
