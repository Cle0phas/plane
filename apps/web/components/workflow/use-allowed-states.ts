/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useMemo } from "react";
import { useParams } from "next/navigation";
import useSWR from "swr";
import { PROJECT_WORK_ITEM_TYPES, PROJECT_WORKFLOW_SCHEME } from "@plane/constants";
// hooks
import { useProjectState } from "@/hooks/store/use-project-state";
import { useUser, useUserPermissions } from "@/hooks/store/user";
import { useWorkflow } from "@/hooks/store/use-workflow";
import { useWorkItemType } from "@/hooks/store/use-work-item-type";
// local imports
import { getAllowedTargetStateIds, getEffectiveTypeId, type TWorkflowActor, type TWorkflowIssue } from "./helpers";

const SWR_OPTIONS = { revalidateIfStale: false, revalidateOnFocus: false };

// Outside project routes no wrapper loads the scheme; the keys match the project wrapper so SWR dedupes.
export const useProjectWorkflowScheme = (projectId: string | undefined) => {
  const { workspaceSlug } = useParams();
  const { getProjectScheme, fetchProjectScheme } = useWorkflow();
  const slug = workspaceSlug?.toString();
  useSWR(
    slug && projectId ? PROJECT_WORKFLOW_SCHEME(projectId) : null,
    slug && projectId ? () => fetchProjectScheme(slug, projectId) : null,
    SWR_OPTIONS
  );
  return projectId ? getProjectScheme(projectId) : undefined;
};

/** Null until the project type links are loaded, so callers fall back to the scheme default workflow. */
export const useProjectDefaultTypeId = (projectId: string | undefined) => {
  const { workspaceSlug } = useParams();
  const { getProjectDefaultTypeId, fetchProjectTypes } = useWorkItemType();
  const slug = workspaceSlug?.toString();
  useSWR(
    slug && projectId ? PROJECT_WORK_ITEM_TYPES(projectId) : null,
    slug && projectId ? () => fetchProjectTypes(slug, projectId) : null,
    SWR_OPTIONS
  );
  return projectId ? getProjectDefaultTypeId(projectId) : null;
};

export const useWorkflowActor = (workspaceSlug: string | undefined, projectId: string | undefined): TWorkflowActor => {
  const { data: currentUser } = useUser();
  const { workspaceProjectsPermissions } = useUserPermissions();
  const userId = currentUser?.id;
  // Raw membership role: the getter elevates workspace admins to ADMIN, the server does not (W6).
  const projectRole = workspaceSlug && projectId ? workspaceProjectsPermissions[workspaceSlug]?.[projectId] : undefined;
  // Stable identity: consumers use it in effect deps.
  return useMemo(() => ({ userId, projectRole }), [userId, projectRole]);
};

/** States offered to the actor for this item (7.4); null when the project is free or the item unknown. */
export const useAllowedStateIds = (
  workspaceSlug: string | undefined,
  projectId: string | undefined,
  issue: TWorkflowIssue | undefined
): Set<string> | null => {
  const scheme = useProjectWorkflowScheme(projectId);
  const { getProjectStates } = useProjectState();
  const projectDefaultTypeId = useProjectDefaultTypeId(projectId);
  const actor = useWorkflowActor(workspaceSlug, projectId);
  if (!issue || !projectId) return null;
  return getAllowedTargetStateIds({
    scheme,
    projectStates: getProjectStates(projectId) ?? [],
    issue: { ...issue, type_id: getEffectiveTypeId(issue.type_id, projectDefaultTypeId) },
    actor,
  });
};
