/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

export type TCloseTarget = { kind: "back" } | { kind: "push"; href: string };

/**
 * Where "Close" leads. The workflow list shows NotAuthorizedView to anyone but a workspace admin, so the
 * others go back to the page they came from (React Router's history index above 0), else to the home.
 */
export const closeTarget = (workspaceSlug: string, isWorkspaceAdmin: boolean, historyIndex?: number): TCloseTarget => {
  if (isWorkspaceAdmin) return { kind: "push", href: `/${workspaceSlug}/settings/workflows` };
  return (historyIndex ?? 0) > 0 ? { kind: "back" } : { kind: "push", href: `/${workspaceSlug}/` };
};
