/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TIssueType } from "@plane/types";

/** A disabled action carries the i18n key of its reason, shown to every user (spec 6.1, 6.6). */
export type TWorkItemTypeActionState = { disabled: boolean; reasonKey?: string };

const ALLOWED: TWorkItemTypeActionState = { disabled: false };

export const getSetDefaultState = (workItemType: TIssueType): TWorkItemTypeActionState =>
  workItemType.is_active
    ? ALLOWED
    : { disabled: true, reasonKey: "work_item_types.settings.cant_set_default_inactive_message" };

export const getDeactivateState = (workItemType: TIssueType): TWorkItemTypeActionState => {
  if (workItemType.is_default)
    return { disabled: true, reasonKey: "work_item_types.settings.disabled_reasons.default_cannot_be_deactivated" };
  if (workItemType.project_default_count > 0)
    return {
      disabled: true,
      reasonKey: "work_item_types.settings.disabled_reasons.project_default_cannot_be_deactivated",
    };
  return ALLOWED;
};

export const getDeleteState = (workItemType: TIssueType): TWorkItemTypeActionState => {
  if (workItemType.is_default)
    return {
      disabled: true,
      reasonKey: "work_item_types.settings.item_delete_confirmation.errors.cannot_delete_default_work_item_type",
    };
  if (workItemType.issue_count > 0)
    return {
      disabled: true,
      reasonKey:
        "work_item_types.settings.item_delete_confirmation.errors.cannot_delete_work_item_type_with_associated_work_items",
    };
  if (workItemType.project_default_count > 0)
    return { disabled: true, reasonKey: "work_item_types.settings.disabled_reasons.project_default_cannot_be_deleted" };
  return ALLOWED;
};

const firstString = (value: unknown): string | undefined => {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
};

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object";

/** Server refusals arrive as {"error": "..."} or DRF field errors {"field": ["..."]}. */
export const getApiErrorMessage = (error: unknown): string | undefined =>
  isRecord(error) ? Object.values(error).map(firstString).find(Boolean) : undefined;

export const getApiFieldError = (error: unknown, field: string): string | undefined =>
  isRecord(error) ? firstString(error[field]) : undefined;
