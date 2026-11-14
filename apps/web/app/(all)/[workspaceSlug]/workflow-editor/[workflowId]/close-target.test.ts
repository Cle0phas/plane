/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import { closeTarget } from "./close-target";

describe("closeTarget", () => {
  it("sends a workspace admin to the workflow list", () => {
    expect(closeTarget("acme", true, 3)).toEqual({ kind: "push", href: "/acme/settings/workflows" });
  });

  it("sends anyone else back to the previous in-app page", () => {
    expect(closeTarget("acme", false, 2)).toEqual({ kind: "back" });
  });

  it("sends anyone else to the workspace home when the editor was the first page", () => {
    expect(closeTarget("acme", false, 0)).toEqual({ kind: "push", href: "/acme/" });
    expect(closeTarget("acme", false, undefined)).toEqual({ kind: "push", href: "/acme/" });
  });
});
