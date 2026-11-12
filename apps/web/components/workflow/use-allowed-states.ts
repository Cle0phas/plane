/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// hooks
import { useProjectState } from "@/hooks/store/use-project-state";
import { useUser, useUserPermissions } from "@/hooks/store/user";
import { useWorkflow } from "@/hooks/store/use-workflow";
// local imports
import { getAllowedTargetStateIds, type TWorkflowActor, type TWorkflowIssue } from "./helpers";

export const useProjectWorkflowScheme = (projectId: string | undefined) => {
  const { getProjectScheme } = useWorkflow();
  return projectId ? getProjectScheme(projectId) : undefined;
};

export const useWorkflowActor = (workspaceSlug: string | undefined, projectId: string | undefined): TWorkflowActor => {
  const { data: currentUser } = useUser();
  const { getProjectRoleByWorkspaceSlugAndProjectId } = useUserPermissions();
  return {
    userId: currentUser?.id,
    projectRole:
      workspaceSlug && projectId ? getProjectRoleByWorkspaceSlugAndProjectId(workspaceSlug, projectId) : undefined,
  };
};

/** States offered to the actor for this item (7.4); null when the project is free or the item unknown. */
export const useAllowedStateIds = (
  workspaceSlug: string | undefined,
  projectId: string | undefined,
  issue: TWorkflowIssue | undefined
): Set<string> | null => {
  const scheme = useProjectWorkflowScheme(projectId);
  const { getProjectStates } = useProjectState();
  const actor = useWorkflowActor(workspaceSlug, projectId);
  if (!issue || !projectId) return null;
  return getAllowedTargetStateIds({ scheme, projectStates: getProjectStates(projectId) ?? [], issue, actor });
};
