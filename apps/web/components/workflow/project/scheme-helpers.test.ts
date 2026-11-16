/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import {
  freeTypeIds,
  schemeChoice,
  unusedWorkflowIds,
  withDefault,
  withWorkflowTypes,
  withoutWorkflow,
  buildSchemePayload,
  getSchemeErrorKey,
  getSchemeNeeds,
  mergeArrivals,
  pendingNeeds,
  schemeRows,
} from "./scheme-helpers";

describe("scheme helpers", () => {
  it("drops types that follow the default and builds mappings", () => {
    expect(
      buildSchemePayload("software", { bug: "support", task: "", story: "software" }, { "s1:support": "st-new" })
    ).toEqual({
      default_workflow_id: "software",
      items: [
        { issue_type_id: "bug", workflow_id: "support" },
        { issue_type_id: "story", workflow_id: "software" },
      ],
      mappings: [{ state_id: "s1", workflow_id: "support", status_id: "st-new" }],
    });
  });

  it("ignores types that are no longer assignable", () => {
    expect(buildSchemePayload("software", { bug: "support", gone: "support" }, {}, ["bug"]).items).toEqual([
      { issue_type_id: "bug", workflow_id: "support" },
    ]);
  });

  it("keeps the arrivals whose need is still present", () => {
    const need = { state_id: "s1", state_name: "A", workflow_id: "w", issue_count: 1, auto_status_id: null };
    expect(mergeArrivals({ "s1:w": "x", "s2:w": "y" }, [need])).toEqual({ "s1:w": "x" });
  });

  it("reads the pending needs out of a refusal", () => {
    const need = { state_id: "s1", state_name: "A", workflow_id: "w", issue_count: 1, auto_status_id: null };
    expect(getSchemeNeeds({ scheme: ["mapping_incomplete"], needs: [need] })).toEqual([need]);
    expect(getSchemeNeeds({ scheme: ["invalid_scheme"] })).toBeNull();
    expect(getSchemeNeeds(null)).toBeNull();
  });

  it("keeps only the needs the server cannot map by name", () => {
    const need = { state_id: "s", state_name: "A", workflow_id: "w", issue_count: 1 };
    expect(
      pendingNeeds([
        { ...need, auto_status_id: "x" },
        { ...need, auto_status_id: null },
      ])
    ).toEqual([{ ...need, auto_status_id: null }]);
  });

  it("maps scheme refusals to i18n keys", () => {
    expect(getSchemeErrorKey({ scheme: ["mapping_incomplete"] })).toBe("workflows.scheme.errors.mapping_incomplete");
    expect(getSchemeErrorKey({ scheme: ["other"] })).toBe("workflows.scheme.errors.default");
    expect(getSchemeErrorKey(null)).toBe("workflows.scheme.errors.default");
  });

  it("falls back to the default key for codes without a message and field errors", () => {
    expect(getSchemeErrorKey({ scheme: ["status_in_use"] })).toBe("workflows.scheme.errors.default");
    expect(getSchemeErrorKey({ mappings: ["duplicate"] })).toBe("workflows.scheme.errors.default");
  });
});

describe("schemeRows", () => {
  it("returns nothing for a project without a scheme", () => {
    expect(schemeRows({ default_workflow_id: null, items: [] })).toEqual([]);
  });

  it("puts the default workflow first and groups the types of each other workflow", () => {
    expect(
      schemeRows({
        default_workflow_id: "default",
        items: [
          { issue_type_id: "bug", workflow_id: "strict" },
          { issue_type_id: "task", workflow_id: "default" },
          { issue_type_id: "story", workflow_id: "strict" },
        ],
      })
    ).toEqual([
      { workflowId: "default", isDefault: true, typeIds: ["task"] },
      { workflowId: "strict", isDefault: false, typeIds: ["bug", "story"] },
    ]);
  });
});

describe("scheme choice", () => {
  const choice = schemeChoice({
    default_workflow_id: "w-default",
    items: [
      { issue_type_id: "bug", workflow_id: "w-strict" },
      { issue_type_id: "story", workflow_id: "w-strict" },
    ],
  });
  const allTypes = ["bug", "story", "task", "epic"];

  it("reads a scheme as a default workflow and a workflow per type", () => {
    expect(choice).toEqual({ defaultWorkflowId: "w-default", items: { bug: "w-strict", story: "w-strict" } });
    expect(schemeChoice({ default_workflow_id: null, items: [] })).toEqual({ defaultWorkflowId: "", items: {} });
  });

  it("gives a workflow exactly the chosen types", () => {
    expect(withWorkflowTypes(choice, "w-free", ["task"]).items).toEqual({
      bug: "w-strict",
      story: "w-strict",
      task: "w-free",
    });
    expect(withWorkflowTypes(choice, "w-strict", ["bug", "task"]).items).toEqual({ bug: "w-strict", task: "w-strict" });
  });

  it("sends the types of a removed workflow back to the default one", () => {
    expect(withoutWorkflow(choice, "w-strict")).toEqual({ defaultWorkflowId: "w-default", items: {} });
  });

  it("replaces the default workflow and keeps the other lines", () => {
    expect(withDefault(choice, "w-free")).toEqual({
      defaultWorkflowId: "w-free",
      items: { bug: "w-strict", story: "w-strict" },
    });
    // A workflow that becomes the default one no longer needs its own lines.
    expect(withDefault(choice, "w-strict")).toEqual({ defaultWorkflowId: "w-strict", items: {} });
  });

  it("lists the types a workflow may take: the free ones and its own", () => {
    expect(freeTypeIds(choice, allTypes)).toEqual(["task", "epic"]);
    expect(freeTypeIds(choice, allTypes, "w-strict")).toEqual(allTypes);
  });

  it("lists the workflows that are not in the table yet", () => {
    expect(unusedWorkflowIds(choice, ["w-default", "w-strict", "w-free"])).toEqual(["w-free"]);
  });
});
