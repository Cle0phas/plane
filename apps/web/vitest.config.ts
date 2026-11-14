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
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["**/*.test.ts"],
          exclude: ["node_modules/**", "build/**", ".react-router/**"],
        },
      },
      {
        // Component tests that need a DOM but not a real browser, like packages/blocks (X12).
        extends: true,
        test: {
          name: "dom",
          environment: "jsdom",
          include: ["**/*.test.tsx"],
          exclude: ["node_modules/**", "build/**", ".react-router/**"],
          setupFiles: ["./vitest.setup.dom.ts"],
        },
      },
    ],
  },
});
