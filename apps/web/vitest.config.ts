/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // inline empty config stops Vite loading the app postcss config, which is irrelevant to node tests
  css: { postcss: {} },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    name: "unit",
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", "build/**", ".react-router/**"],
  },
});
