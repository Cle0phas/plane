/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TIssueType, TProjectIssueType } from "@plane/types";

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

export const getProjectToggleState = (link: TProjectIssueType | undefined): TWorkItemTypeActionState => {
  if (!link) return ALLOWED;
  if (link.is_default)
    return { disabled: true, reasonKey: "work_item_types.settings.project.disabled_reasons.project_default" };
  if (link.issue_count > 0)
    return { disabled: true, reasonKey: "work_item_types.settings.project.disabled_reasons.in_use" };
  return ALLOWED;
};

export const getProjectDefaultState = (
  link: TProjectIssueType | undefined,
  workItemType: Pick<TIssueType, "is_active">
): TWorkItemTypeActionState => {
  if (!link) return { disabled: true, reasonKey: "work_item_types.settings.project.disabled_reasons.not_enabled" };
  // R7: an inactive type stays linked but cannot become the default.
  if (!workItemType.is_active)
    return { disabled: true, reasonKey: "work_item_types.settings.cant_set_default_inactive_message" };
  return ALLOWED;
};

/** R7: inactive types cannot be added, but stay listed while the project still uses them. */
export const getProjectListTypes = (workItemTypes: TIssueType[], hasLink: (typeId: string) => boolean): TIssueType[] =>
  workItemTypes.filter((workItemType) => workItemType.is_active || hasLink(workItemType.id));

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object";

type TWorkItemTypeFormField = "name" | "description";

/**
 * Maps DRF field errors to localized keys; server text is never shown. The client already blocks an empty or
 * too long name, so a server name error is the duplicate rule.
 */
export const getFormFieldErrorKeys = (
  error: unknown,
  mode: "create" | "update"
): Partial<Record<TWorkItemTypeFormField, string>> => {
  if (!isRecord(error)) return {};
  const keys: Partial<Record<TWorkItemTypeFormField, string>> = {};
  if (Array.isArray(error.name)) keys.name = `work_item_types.${mode}.toast.error.message.conflict`;
  if (Array.isArray(error.description)) keys.description = "work_item_types.create_update.form.description.max_length";
  return keys;
};

export type TWorkItemTypeRowAction =
  | "set_default"
  | "deactivate"
  | "reactivate"
  | "delete"
  | "project_enable"
  | "project_disable"
  | "project_set_default";

// Only the set default actions have a single possible refusal (inactive type); the others fall back to the default message.
const ACTION_REFUSAL_KEYS: Partial<Record<TWorkItemTypeRowAction, string>> = {
  set_default: "work_item_types.settings.cant_set_default_inactive_message",
  project_set_default: "work_item_types.settings.cant_set_default_inactive_message",
};

export const getActionRefusalKey = (error: unknown, action: TWorkItemTypeRowAction): string | undefined =>
  isRecord(error) && typeof error.error === "string" ? ACTION_REFUSAL_KEYS[action] : undefined;
