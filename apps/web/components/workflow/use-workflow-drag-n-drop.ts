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
// local imports
import { isWorkflowDropForbidden } from "./drag-n-drop-helpers";
import { getAllowedTargetStateIds, getEffectiveTypeId } from "./helpers";
import { useProjectDefaultTypeId, useProjectWorkflowScheme, useWorkflowActor } from "./use-allowed-states";

/** Each column calls it: the column learns whether the item being dragged may land in it (spec 7.4). */
export const useWorkFlowFDragNDrop = (groupBy: TIssueGroupByOptions | undefined, subGroupBy?: TIssueGroupByOptions) => {
  const { workspaceSlug, projectId } = useParams();
  const scheme = useProjectWorkflowScheme(projectId?.toString());
  const projectDefaultTypeId = useProjectDefaultTypeId(projectId?.toString());
  const actor = useWorkflowActor(workspaceSlug?.toString(), projectId?.toString());
  const { getProjectStates } = useProjectState();
  const { getProjectScheme } = useWorkflow();
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
            issue: { ...issue, type_id: getEffectiveTypeId(issue.type_id, projectDefaultTypeId) },
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
    [scheme, getProjectScheme, projectDefaultTypeId, actor, getProjectStates, groupBy, subGroupBy]
  );

  const resetWorkFlowState = useCallback(() => setWorkflowDisabledSource(undefined), []);

  return {
    workflowDisabledSource,
    isWorkflowDropDisabled: workflowDisabledSource !== undefined,
    // Creation stays possible in any column: the server puts new items in the initial state (T1).
    getIsWorkflowWorkItemCreationDisabled: (_groupId: string, _subGroupId?: string) => false,
    handleWorkFlowState,
    resetWorkFlowState,
  };
};
