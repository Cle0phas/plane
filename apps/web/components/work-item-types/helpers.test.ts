/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import type { TIssueType } from "@plane/types";
import {
  getApiErrorMessage,
  getApiFieldError,
  getDeactivateState,
  getDeleteState,
  getSetDefaultState,
} from "./helpers";

const buildType = (overrides: Partial<TIssueType> = {}): TIssueType => ({
  id: "bug",
  name: "Bug",
  description: "",
  logo_props: { in_use: "icon", icon: { name: "bug_report", color: "#e57a00" } },
  is_active: true,
  is_default: false,
  issue_count: 0,
  project_default_count: 0,
  created_at: "2026-11-12T00:00:00Z",
  updated_at: "2026-11-12T00:00:00Z",
  ...overrides,
});

describe("workspace work item type actions", () => {
  it("lets an active type become the default", () => {
    expect(getSetDefaultState(buildType())).toEqual({ disabled: false });
  });

  it("refuses an inactive type as default and says why", () => {
    expect(getSetDefaultState(buildType({ is_active: false }))).toEqual({
      disabled: true,
      reasonKey: "work_item_types.settings.cant_set_default_inactive_message",
    });
  });

  it("refuses to deactivate the default type", () => {
    expect(getDeactivateState(buildType({ is_default: true }))).toEqual({
      disabled: true,
      reasonKey: "work_item_types.settings.disabled_reasons.default_cannot_be_deactivated",
    });
  });

  it("refuses to deactivate the default type of a project", () => {
    expect(getDeactivateState(buildType({ project_default_count: 2 }))).toEqual({
      disabled: true,
      reasonKey: "work_item_types.settings.disabled_reasons.project_default_cannot_be_deactivated",
    });
  });

  it("allows deactivating any other type", () => {
    expect(getDeactivateState(buildType())).toEqual({ disabled: false });
  });

  it("refuses to delete the default type", () => {
    expect(getDeleteState(buildType({ is_default: true }))).toEqual({
      disabled: true,
      reasonKey: "work_item_types.settings.item_delete_confirmation.errors.cannot_delete_default_work_item_type",
    });
  });

  it("refuses to delete a type used by work items", () => {
    expect(getDeleteState(buildType({ issue_count: 3 }))).toEqual({
      disabled: true,
      reasonKey:
        "work_item_types.settings.item_delete_confirmation.errors.cannot_delete_work_item_type_with_associated_work_items",
    });
  });

  it("refuses to delete the default type of a project", () => {
    expect(getDeleteState(buildType({ project_default_count: 1 }))).toEqual({
      disabled: true,
      reasonKey: "work_item_types.settings.disabled_reasons.project_default_cannot_be_deleted",
    });
  });

  it("allows deleting an unused type", () => {
    expect(getDeleteState(buildType())).toEqual({ disabled: false });
  });
});

describe("api error reading", () => {
  it("reads a refusal message", () => {
    expect(getApiErrorMessage({ error: "The project default work item type cannot be removed." })).toBe(
      "The project default work item type cannot be removed."
    );
  });

  it("reads the first field error", () => {
    expect(getApiErrorMessage({ name: ["A work item type with this name already exists."] })).toBe(
      "A work item type with this name already exists."
    );
    expect(getApiFieldError({ name: ["Duplicate."] }, "name")).toBe("Duplicate.");
  });

  it("returns nothing for an unknown shape", () => {
    expect(getApiErrorMessage(undefined)).toBeUndefined();
    expect(getApiErrorMessage({ detail: 3 })).toBeUndefined();
    expect(getApiFieldError({ error: "x" }, "name")).toBeUndefined();
  });
});
