/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TIssueGroupByOptions } from "@plane/types";

/** Spec 7.4: a drop changes the state only when a state column or sub-group is the destination. */
export const isWorkflowDropForbidden = ({
  groupBy,
  subGroupBy,
  destinationGroupId,
  destinationSubGroupId,
  allowed,
}: {
  groupBy: TIssueGroupByOptions | undefined;
  subGroupBy?: TIssueGroupByOptions;
  destinationGroupId: string;
  destinationSubGroupId?: string;
  allowed: Set<string> | null;
}) => {
  if (!allowed) return false;
  if (groupBy === "state" && !allowed.has(destinationGroupId)) return true;
  return subGroupBy === "state" && !!destinationSubGroupId && !allowed.has(destinationSubGroupId);
};
