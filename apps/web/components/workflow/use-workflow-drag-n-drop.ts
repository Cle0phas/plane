/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useState } from "react";
import { useParams } from "next/navigation";
import type { TIssue, TIssueGroupByOptions } from "@plane/types";
// hooks
import { useProjectState } from "@/hooks/store/use-project-state";
import { useWorkflow } from "@/hooks/store/use-workflow";
import { useWorkItemType } from "@/hooks/store/use-work-item-type";
// local imports
import { isWorkflowCreationDisabled, isWorkflowDropForbidden } from "./drag-n-drop-helpers";
import { getAllowedTargetStateIds, getEffectiveTypeId, getInitialStateId } from "./helpers";
import { useProjectDefaultTypeId, useProjectWorkflowScheme, useWorkflowActor } from "./use-allowed-states";

/** Each column calls it: the column learns whether the item being dragged may land in it (spec 7.4). */
export const useWorkFlowFDragNDrop = (groupBy: TIssueGroupByOptions | undefined, subGroupBy?: TIssueGroupByOptions) => {
  const { workspaceSlug, projectId } = useParams();
  const scheme = useProjectWorkflowScheme(projectId?.toString());
  const projectDefaultTypeId = useProjectDefaultTypeId(projectId?.toString());
  const actor = useWorkflowActor(workspaceSlug?.toString(), projectId?.toString());
  const { getProjectStates } = useProjectState();
  const { getProjectScheme } = useWorkflow();
  const { getProjectDefaultTypeId } = useWorkItemType();
  const [workflowDisabledSource, setWorkflowDisabledSource] = useState<string | undefined>(undefined);

  const handleWorkFlowState = useCallback(
    (
      sourceGroupId: string,
      destinationGroupId: string,
      _sourceSubGroupId?: string,
      destinationSubGroupId?: string,
      issue?: TIssue
    ) => {
      const allowed = issue?.project_id
        ? getAllowedTargetStateIds({
            // The item's own project, so workspace-level views block too once its scheme is loaded.
            scheme: getProjectScheme(issue.project_id) ?? scheme,
            projectStates: getProjectStates(issue.project_id) ?? [],
            // The item's own project default type; the route project's when not loaded yet.
            issue: {
              ...issue,
              type_id: getEffectiveTypeId(
                issue.type_id,
                getProjectDefaultTypeId(issue.project_id) ?? projectDefaultTypeId
              ),
            },
            actor,
          })
        : null;
      const forbidden = isWorkflowDropForbidden({
        groupBy,
        subGroupBy,
        destinationGroupId,
        destinationSubGroupId,
        allowed,
      });
      setWorkflowDisabledSource(forbidden ? sourceGroupId : undefined);
    },
    [
      scheme,
      getProjectScheme,
      getProjectDefaultTypeId,
      projectDefaultTypeId,
      actor,
      getProjectStates,
      groupBy,
      subGroupBy,
    ]
  );

  // Undefined for a free project; new items of a linked one start in the initial state of their type's workflow (T1).
  const getWorkflowInitialStateId = (typeId?: string | null) =>
    projectId
      ? getInitialStateId(
          scheme,
          getProjectStates(projectId.toString()) ?? [],
          getEffectiveTypeId(typeId, projectDefaultTypeId)
        )
      : undefined;

  const resetWorkFlowState = useCallback(() => setWorkflowDisabledSource(undefined), []);

  return {
    workflowDisabledSource,
    isWorkflowDropDisabled: workflowDisabledSource !== undefined,
    getWorkflowInitialStateId,
    getIsWorkflowWorkItemCreationDisabled: (groupId: string, subGroupId?: string) =>
      isWorkflowCreationDisabled({
        groupBy,
        subGroupBy,
        groupId,
        subGroupId,
        initialStateId: getWorkflowInitialStateId(),
      }),
    handleWorkFlowState,
    resetWorkFlowState,
  };
};
