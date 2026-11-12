/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import type { TIssueType, TProjectIssueType } from "@plane/types";
import {
  getActionRefusalKey,
  getDeactivateState,
  getDeleteState,
  getFormFieldErrorKeys,
  getIdentifierVisibility,
  getProjectDefaultState,
  getProjectListTypes,
  getProjectToggleState,
  getSetDefaultState,
  getTypeIdAfterProjectChange,
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

describe("form refusal mapping", () => {
  it("maps a server name error to the localized duplicate message", () => {
    expect(getFormFieldErrorKeys({ name: ["A work item type with this name already exists."] }, "create")).toEqual({
      name: "work_item_types.create.toast.error.message.conflict",
    });
    expect(getFormFieldErrorKeys({ name: ["x"] }, "update")).toEqual({
      name: "work_item_types.update.toast.error.message.conflict",
    });
  });

  it("maps a server description error to the localized length message", () => {
    expect(getFormFieldErrorKeys({ description: ["Too long."] }, "create")).toEqual({
      description: "work_item_types.create_update.form.description.max_length",
    });
  });

  it("maps nothing for other shapes, so the localized default is shown", () => {
    expect(getFormFieldErrorKeys({ logo_props: ["bad"] }, "create")).toEqual({});
    expect(getFormFieldErrorKeys({ detail: "Not found." }, "create")).toEqual({});
    expect(getFormFieldErrorKeys(undefined, "update")).toEqual({});
  });
});

describe("row action refusal mapping", () => {
  it("names the reason of a refused set default", () => {
    expect(getActionRefusalKey({ error: "An inactive work item type cannot be the default." }, "set_default")).toBe(
      "work_item_types.settings.cant_set_default_inactive_message"
    );
  });

  it("falls back to the default message when the action has several possible refusals", () => {
    expect(
      getActionRefusalKey({ error: "This work item type is the default of a project." }, "delete")
    ).toBeUndefined();
    expect(getActionRefusalKey({ error: "x" }, "deactivate")).toBeUndefined();
  });

  it("ignores anything that is not a refusal", () => {
    expect(getActionRefusalKey({ detail: "Not found." }, "set_default")).toBeUndefined();
    expect(getActionRefusalKey(undefined, "set_default")).toBeUndefined();
  });
});

const buildLink = (overrides: Partial<TProjectIssueType> = {}): TProjectIssueType => ({
  id: "link",
  project_id: "p1",
  issue_type_id: "bug",
  is_default: false,
  issue_count: 0,
  ...overrides,
});

describe("project work item type actions", () => {
  it("lets an admin enable a type that is not used yet", () => {
    expect(getProjectToggleState(undefined)).toEqual({ disabled: false });
  });

  it("refuses to remove the project default", () => {
    expect(getProjectToggleState(buildLink({ is_default: true }))).toEqual({
      disabled: true,
      reasonKey: "work_item_types.settings.project.disabled_reasons.project_default",
    });
  });

  it("refuses to remove a type used by work items of the project", () => {
    expect(getProjectToggleState(buildLink({ issue_count: 1 }))).toEqual({
      disabled: true,
      reasonKey: "work_item_types.settings.project.disabled_reasons.in_use",
    });
  });

  it("allows removing an unused type", () => {
    expect(getProjectToggleState(buildLink())).toEqual({ disabled: false });
  });

  it("only offers the default choice for an enabled type", () => {
    expect(getProjectDefaultState(undefined, buildType())).toEqual({
      disabled: true,
      reasonKey: "work_item_types.settings.project.disabled_reasons.not_enabled",
    });
    expect(getProjectDefaultState(buildLink(), buildType())).toEqual({ disabled: false });
  });

  it("refuses the default choice for an inactive type that is still linked", () => {
    expect(getProjectDefaultState(buildLink(), buildType({ is_active: false }))).toEqual({
      disabled: true,
      reasonKey: "work_item_types.settings.cant_set_default_inactive_message",
    });
  });

  it("lists inactive types only while the project still uses them", () => {
    const active = buildType({ id: "a" });
    const inactiveLinked = buildType({ id: "b", is_active: false });
    const inactiveFree = buildType({ id: "c", is_active: false });
    expect(getProjectListTypes([active, inactiveLinked, inactiveFree], (id) => id === "b")).toEqual([
      active,
      inactiveLinked,
    ]);
  });
});

describe("project refusal keys", () => {
  it("maps an inactive default refusal and leaves other refusals to the default message", () => {
    expect(getActionRefusalKey({ error: "x" }, "project_set_default")).toBe(
      "work_item_types.settings.cant_set_default_inactive_message"
    );
    expect(getActionRefusalKey({ error: "x" }, "project_disable")).toBeUndefined();
  });
});

describe("identifier visibility", () => {
  it("shows the key and the type by default", () => {
    expect(getIdentifierVisibility(undefined)).toEqual({ showKey: true, showType: true });
  });

  it("follows the display properties of the view", () => {
    expect(getIdentifierVisibility({ key: true, issue_type: false })).toEqual({ showKey: true, showType: false });
    expect(getIdentifierVisibility({ key: false, issue_type: true })).toEqual({ showKey: false, showType: true });
  });

  it("shows the type when the view does not set the property", () => {
    expect(getIdentifierVisibility({ key: true })).toEqual({ showKey: true, showType: true });
  });
});

describe("type id after a project change", () => {
  const resolve = (overrides: Partial<Parameters<typeof getTypeIdAfterProjectChange>[0]>) =>
    getTypeIdAfterProjectChange({
      typeId: "bug",
      isProjectChange: false,
      assignableTypeIds: ["task", "bug"],
      projectDefaultTypeId: "task",
      ...overrides,
    });

  it("keeps an assignable type while the project stays the same", () => {
    expect(resolve({})).toBe("bug");
  });

  it("replaces a type the project does not allow with the project default", () => {
    expect(resolve({ typeId: "epic" })).toBe("task");
  });

  it("keeps a preset type until the project links are loaded", () => {
    expect(resolve({ typeId: "epic", assignableTypeIds: undefined, projectDefaultTypeId: null })).toBe("epic");
  });

  it("fills an empty type with the project default", () => {
    expect(resolve({ typeId: null })).toBe("task");
  });

  it("resets a chosen type to the new project default", () => {
    expect(resolve({ isProjectChange: true, assignableTypeIds: ["story", "bug"], projectDefaultTypeId: "story" })).toBe(
      "story"
    );
  });

  it("clears the type when the new project links are not loaded, so the server assigns the default", () => {
    expect(resolve({ isProjectChange: true, assignableTypeIds: undefined, projectDefaultTypeId: null })).toBeNull();
  });
});
