/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TStateTone } from "./graph-model";

/** Jira's category colours (R16, J2), from theme tokens so both themes keep AA contrast. */
export const TONE_CLASS: Record<TStateTone, string> = {
  backlog: "border-dashed border-strong bg-surface-1 text-secondary",
  todo: "border-subtle bg-layer-2 text-secondary",
  progress: "border-info-subtle bg-info-subtle text-info-primary",
  done: "border-success-subtle bg-success-subtle text-success-primary",
  cancelled: "border-danger-subtle bg-danger-subtle text-danger-primary",
};

/** Solid fills of the 4px category bar of the workflow list (decorative). */
export const BAR_CLASS: Record<TStateTone, string> = {
  backlog: "bg-layer-2",
  todo: "bg-layer-3",
  progress: "bg-info-primary",
  done: "bg-success-primary",
  cancelled: "bg-danger-primary",
};

/** Dark shape with light text in both themes: start node and "any state" pills. */
export const INVERSE_CLASS = "bg-(--text-color-primary) text-(--background-color-surface-1)";
