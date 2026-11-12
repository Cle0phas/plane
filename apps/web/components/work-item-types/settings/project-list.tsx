/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import { Checkbox } from "@makeplane/propel/components/checkbox";
import { Radio, RadioGroup } from "@makeplane/propel/components/radio";
import { setToast } from "@plane/blocks/toast";
import { useTranslation } from "@plane/i18n";
import type { TIssueType } from "@plane/types";
// components
import {
  getActionRefusalKey,
  getProjectDefaultState,
  getProjectListTypes,
  getProjectToggleState,
} from "@/components/work-item-types/helpers";
import type { TWorkItemTypeRowAction } from "@/components/work-item-types/helpers";
import { WorkItemTypeIcon } from "@/components/work-item-types/work-item-type-icon";
// hooks
import { useWorkItemType } from "@/hooks/store/use-work-item-type";

type TRowProps = {
  workspaceSlug: string;
  projectId: string;
  workItemType: TIssueType;
  isPending: boolean;
  onRun: (action: TWorkItemTypeRowAction, operation: () => Promise<void>) => void;
};

const ProjectWorkItemTypeRow = observer(function ProjectWorkItemTypeRow(props: TRowProps) {
  const { workspaceSlug, projectId, workItemType, isPending, onRun } = props;
  const { t } = useTranslation();
  const { getProjectTypeLink, enableInProject, disableInProject } = useWorkItemType();
  const link = getProjectTypeLink(projectId, workItemType.id);
  const toggleState = getProjectToggleState(link);
  const defaultState = getProjectDefaultState(link, workItemType);
  const baseId = `work-item-type-${workItemType.id}`;
  const nameId = `${baseId}-name`;
  const reasonId = `${baseId}-reason`;
  // The reason is visible text referenced by aria-describedby, so assistive tech announces it with the disabled control.
  const toggleReasonKey = toggleState.reasonKey;
  const defaultReasonKey = defaultState.reasonKey;
  const shownReasonKey = toggleReasonKey ?? defaultReasonKey;

  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <WorkItemTypeIcon workItemType={workItemType} size={18} decorative />
      <div className="min-w-0 flex-1">
        <span id={nameId} className="truncate text-body-sm-medium text-primary">
          {workItemType.name}
        </span>
        {shownReasonKey && (
          <p id={reasonId} className="text-body-xs-regular text-tertiary">
            {t(shownReasonKey)}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Checkbox
          checked={!!link}
          disabled={isPending || toggleState.disabled}
          aria-labelledby={`${nameId} ${baseId}-used`}
          aria-describedby={toggleReasonKey ? reasonId : undefined}
          onCheckedChange={(checked) =>
            checked
              ? onRun("project_enable", () => enableInProject(workspaceSlug, projectId, workItemType.id))
              : onRun("project_disable", () => disableInProject(workspaceSlug, projectId, workItemType.id))
          }
        />
        <span id={`${baseId}-used`} className="text-body-xs-regular text-secondary">
          {t("work_item_types.settings.project.used_in_project")}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Radio
          value={workItemType.id}
          disabled={isPending || defaultState.disabled}
          aria-labelledby={`${nameId} ${baseId}-default`}
          aria-describedby={defaultReasonKey ? reasonId : undefined}
        />
        <span id={`${baseId}-default`} className="text-body-xs-regular text-secondary">
          {t("work_item_types.settings.project.set_default")}
        </span>
      </div>
    </li>
  );
});

type TProjectWorkItemTypeListProps = { workspaceSlug: string; projectId: string };

export const ProjectWorkItemTypeList = observer(function ProjectWorkItemTypeList(props: TProjectWorkItemTypeListProps) {
  const { workspaceSlug, projectId } = props;
  const [isPending, setIsPending] = useState(false);
  const { t } = useTranslation();
  const { getWorkspaceTypes, getProjectTypeLink, getProjectDefaultTypeId, setProjectDefault, fetchProjectTypes } =
    useWorkItemType();
  const workItemTypes = getProjectListTypes(
    getWorkspaceTypes(workspaceSlug),
    (typeId) => !!getProjectTypeLink(projectId, typeId)
  );

  // One write at a time: a default switch and a toggle must not race on the same project.
  const run = async (action: TWorkItemTypeRowAction, operation: () => Promise<void>) => {
    setIsPending(true);
    try {
      await operation();
    } catch (error) {
      setToast({
        type: "error",
        title: t("common.error.label"),
        message: t(getActionRefusalKey(error, action) ?? "work_item_types.settings.project.toast_error"),
      });
      // A refusal means the server state differs from the screen: reload it so the real reason shows.
      await fetchProjectTypes(workspaceSlug, projectId).catch(() => undefined);
    } finally {
      setIsPending(false);
    }
  };

  return (
    <RadioGroup
      density="compact"
      aria-label={t("work_item_types.settings.project.set_default")}
      value={getProjectDefaultTypeId(projectId)}
      onValueChange={(typeId) => {
        if (typeof typeId === "string")
          void run("project_set_default", () => setProjectDefault(workspaceSlug, projectId, typeId));
      }}
    >
      <ul aria-label={t("work_item_types.label")} className="divide-y divide-subtle rounded-lg border border-subtle">
        {workItemTypes.map((workItemType) => (
          <ProjectWorkItemTypeRow
            key={workItemType.id}
            workspaceSlug={workspaceSlug}
            projectId={projectId}
            workItemType={workItemType}
            isPending={isPending}
            onRun={(action, operation) => void run(action, operation)}
          />
        ))}
      </ul>
    </RadioGroup>
  );
});
