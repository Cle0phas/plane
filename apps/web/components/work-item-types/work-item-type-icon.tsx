/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { Tooltip } from "@makeplane/propel/components/tooltip";
import { Logo } from "@plane/blocks/emoji-icon-picker";
import type { TIssueType } from "@plane/types";
import { cn } from "@plane/utils";

type TWorkItemTypeIconProps = {
  workItemType: Pick<TIssueType, "name" | "logo_props">;
  size?: number;
  showTooltip?: boolean;
  /** Set when the type name is visible next to the icon, so screen readers do not read it twice. */
  decorative?: boolean;
  className?: string;
};

export function WorkItemTypeIcon(props: TWorkItemTypeIconProps) {
  const { workItemType, size = 14, showTooltip = false, decorative = false, className } = props;
  // The type name is the accessible text of the glyph (spec 6.6).
  const a11yProps = decorative ? { "aria-hidden": true } : { role: "img", "aria-label": workItemType.name };
  const icon = (
    <span {...a11yProps} className={cn("flex shrink-0 items-center justify-center", className)}>
      <Logo logo={workItemType.logo_props} size={size} />
    </span>
  );
  if (!showTooltip) return icon;
  return <Tooltip label={workItemType.name}>{icon}</Tooltip>;
}
