/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type {
  IIssueDisplayProperties,
  TGroupedIssues,
  TIssueType,
  TProjectIssueType,
  TSubGroupedIssues,
} from "@plane/types";

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

/** Only an explicit false hides the type icon: saved views predate the issue_type property (spec 6.5). */
export const getIdentifierVisibility = (displayProperties: IIssueDisplayProperties | undefined) => ({
  showKey: displayProperties ? !!displayProperties.key : true,
  showType: displayProperties?.issue_type !== false,
});

/**
 * A type is only valid in the projects that enable it (R9): a project change resets it, and a preset type (duplicate,
 * template) the project does not allow falls back to the default. Unloaded links (undefined) keep the preset pending.
 */
export const getTypeIdAfterProjectChange = (params: {
  typeId: string | null | undefined;
  isProjectChange: boolean;
  assignableTypeIds: string[] | undefined;
  projectDefaultTypeId: string | null;
}): string | null => {
  const { typeId, isProjectChange, assignableTypeIds, projectDefaultTypeId } = params;
  if (isProjectChange || !typeId) return projectDefaultTypeId;
  if (!assignableTypeIds || assignableTypeIds.includes(typeId)) return typeId;
  return projectDefaultTypeId;
};

/** The type is chosen at creation only (spec 6.3); converting a draft is a creation, so editing a draft offers it too. */
export const canChooseTypeInForm = (params: { isEditing: boolean; isDraft: boolean }): boolean =>
  !params.isEditing || params.isDraft;

export const getWorkItemTypeChange = (currentTypeId: string | null | undefined, nextTypeId: string) =>
  currentTypeId === nextTypeId ? null : { type_id: nextTypeId };

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

// Only the workspace set default has a single possible refusal (inactive type); the others fall back to the default message.
const ACTION_REFUSAL_KEYS: Partial<Record<TWorkItemTypeRowAction, string>> = {
  set_default: "work_item_types.settings.cant_set_default_inactive_message",
};

export const getActionRefusalKey = (error: unknown, action: TWorkItemTypeRowAction): string | undefined =>
  isRecord(error) && typeof error.error === "string" ? ACTION_REFUSAL_KEYS[action] : undefined;

/** Quick-add in a type column pre-fills the type only when the project allows it; "None" and unknown columns never match. */
export const getQuickAddTypeData = (columnId: string, assignableTypes: Pick<TIssueType, "id">[]) =>
  assignableTypes.some((workItemType) => workItemType.id === columnId) ? { type_id: columnId } : {};

/**
 * Group ids (level "group") or sub group ids (level "subGroup") holding work items in the loaded data.
 * The store keys sub-grouped data as [groupId][subGroupId].
 */
export const getLoadedGroupIds = (
  groupedIssueIds: TGroupedIssues | TSubGroupedIssues | undefined,
  level: "group" | "subGroup" = "group"
): string[] => {
  if (!groupedIssueIds) return [];
  const topLevelKeys = Object.keys(groupedIssueIds);
  const isFlat = Object.values(groupedIssueIds).every((value) => Array.isArray(value));
  if (isFlat) return level === "group" ? topLevelKeys : [];
  if (level === "group") return topLevelKeys;
  const nestedKeys = Object.values(groupedIssueIds).flatMap((value) =>
    Array.isArray(value) ? [] : Object.keys(value)
  );
  return [...new Set(nestedKeys)];
};

export type TWorkItemTypeColumnEntry = {
  id: string;
  name: string;
  /** Set for a known type, so the caller renders its icon. */
  workItemType?: TIssueType;
  payload: { type_id?: string };
  isDropDisabled?: boolean;
};

/**
 * Columns of a "group by type" layout: the workspace types, then a neutral column for a type id present in the data
 * but missing from the store (soft-deleted), then "None". Never shows a raw id.
 */
export const getWorkItemTypeColumnEntries = (
  workItemTypes: TIssueType[],
  loadedGroupIds: string[],
  labels: { unknown: string; none: string }
): TWorkItemTypeColumnEntry[] => {
  const knownIds = new Set(workItemTypes.map((workItemType) => workItemType.id));
  return [
    ...workItemTypes.map((workItemType) => ({
      id: workItemType.id,
      name: workItemType.name,
      workItemType,
      payload: { type_id: workItemType.id },
    })),
    ...loadedGroupIds
      .filter((groupId) => groupId !== "None" && !knownIds.has(groupId))
      .map((groupId) => ({ id: groupId, name: labels.unknown, payload: {}, isDropDisabled: true })),
    { id: "None", name: labels.none, payload: {}, isDropDisabled: true },
  ];
};
