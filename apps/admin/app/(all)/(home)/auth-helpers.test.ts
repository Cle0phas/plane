/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import { EAdminAuthErrorCodes } from "@plane/constants";
import { authErrorHandler, EErrorAlertType } from "./auth-helpers";

// The API redirects with the numeric code of plane/authentication/adapter/error.py in `error_code`
describe("authErrorHandler", () => {
  it.each([
    ["5000", "Instance not configured"],
    ["5021", "Password too weak"],
    ["5150", "Admin already exists"],
    ["5900", "Rate limit exceeded"],
  ])("returns a banner for the error code %s sent by the admin sign-up endpoint", (code, title) => {
    expect(authErrorHandler(code as EAdminAuthErrorCodes)).toMatchObject({
      type: EErrorAlertType.BANNER_ALERT,
      code,
      title,
    });
  });

  // The setup form renders these under their field, which only accepts a string
  it.each(["5021", "5160"])("returns a plain string message for the inline error code %s", (code) => {
    expect(typeof authErrorHandler(code as EAdminAuthErrorCodes)?.message).toBe("string");
  });

  it("returns undefined for an unknown error code", () => {
    expect(authErrorHandler("9999" as EAdminAuthErrorCodes)).toBeUndefined();
  });
});
