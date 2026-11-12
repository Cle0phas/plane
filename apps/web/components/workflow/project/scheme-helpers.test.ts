/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import { buildSchemePayload, getSchemeErrorKey, pendingNeeds } from "./scheme-helpers";

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
