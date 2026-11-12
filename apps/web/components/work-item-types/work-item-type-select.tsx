/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import useSWR from "swr";
// plane imports
import { PROJECT_WORK_ITEM_TYPES } from "@plane/constants";
import { Select } from "@plane/blocks/select";
import type { SelectVariant } from "@plane/blocks/select";
import type { TIssueType } from "@plane/types";
// components
import { WorkItemTypeIcon } from "@/components/work-item-types/work-item-type-icon";
// hooks
import { useWorkItemType } from "@/hooks/store/use-work-item-type";

type TWorkItemTypeSelectProps = {
  projectId: string | null | undefined;
  value: string | null | undefined;
  onChange: (typeId: string) => void;
  variant: SelectVariant;
  /** Property name; the trigger announces it with the selected type, so no separate label element is needed. */
  label: string;
  disabled?: boolean;
  tabIndex?: number;
  testId?: string;
};

export const WorkItemTypeSelect = observer(function WorkItemTypeSelect(props: TWorkItemTypeSelectProps) {
  const { projectId, value, onChange, variant, label, disabled = false, tabIndex, testId } = props;
  const { workspaceSlug: routeWorkspaceSlug } = useParams();
  const workspaceSlug = routeWorkspaceSlug?.toString() ?? "";
  const { getProjectAssignableTypes, getProjectDefaultTypeId, getTypeById, fetchProjectTypes } = useWorkItemType();
  // The modal can target a project other than the route one, whose links the project wrapper did not load.
  useSWR(
    workspaceSlug && projectId ? PROJECT_WORK_ITEM_TYPES(projectId) : null,
    workspaceSlug && projectId ? () => fetchProjectTypes(workspaceSlug, projectId) : null,
    { revalidateIfStale: false, revalidateOnFocus: false }
  );
  const options = projectId ? getProjectAssignableTypes(workspaceSlug, projectId) : [];
  // An empty value is shown as the project default, which the server assigns on save (R9).
  const selected = getTypeById(workspaceSlug, value || (projectId ? getProjectDefaultTypeId(projectId) : null)) ?? null;

  return (
    <Select<TIssueType>
      getValues={() => options}
      value={selected}
      onChange={(typeId) => {
        if (typeId) onChange(typeId);
      }}
      disabled={disabled}
      placeholder={label}
      showSearch={false}
      pinSelected={false}
      getOptionValue={(option) => option.id}
      getOptionLabel={(option) => option.name}
      getOptionIcon={(option) => <WorkItemTypeIcon workItemType={option} size={16} decorative />}
    >
      <Select.Trigger<TIssueType>
        disabled={disabled}
        variant={variant}
        tabIndex={tabIndex}
        data-testid={testId}
        prependIcon={(types) => (types[0] ? <WorkItemTypeIcon workItemType={types[0]} decorative /> : undefined)}
        label={(types) => types[0]?.name ?? label}
      >
        {(types) => <span className="min-w-0 grow truncate text-left">{types[0]?.name ?? label}</span>}
      </Select.Trigger>
    </Select>
  );
});
