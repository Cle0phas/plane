/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import path from "node:path";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tsconfigPaths({ projects: [path.resolve(__dirname, "tsconfig.json")] })],
  test: {
    name: "unit",
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", "build/**"],
    environment: "node",
  },
  resolve: {
    // Same Next.js compatibility shims as vite.config.ts, without the React Router plugin
    alias: {
      "next/link": path.resolve(__dirname, "app/compat/next/link.tsx"),
      "next/navigation": path.resolve(__dirname, "app/compat/next/navigation.ts"),
    },
  },
});
