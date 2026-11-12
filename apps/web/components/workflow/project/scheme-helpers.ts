/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TProjectWorkflowSchemePayload, TWorkflowMappingNeed } from "@plane/types";

const SCHEME_ERROR_CODES = new Set(["invalid_scheme", "mapping_incomplete", "invalid_mapping"]);

export const needKey = (need: Pick<TWorkflowMappingNeed, "state_id" | "workflow_id">) =>
  `${need.state_id}:${need.workflow_id}`;

export const buildSchemePayload = (
  defaultWorkflowId: string,
  typeChoices: Record<string, string>,
  arrivals: Record<string, string>,
  allowedTypeIds?: string[]
): TProjectWorkflowSchemePayload => ({
  default_workflow_id: defaultWorkflowId,
  items: Object.entries(typeChoices)
    .filter(
      ([issueTypeId, workflowId]) => workflowId !== "" && (!allowedTypeIds || allowedTypeIds.includes(issueTypeId))
    )
    .map(([issueTypeId, workflowId]) => ({ issue_type_id: issueTypeId, workflow_id: workflowId })),
  mappings: Object.entries(arrivals).map(([key, statusId]) => {
    const [stateId, workflowId] = key.split(":");
    return { state_id: stateId, workflow_id: workflowId, status_id: statusId };
  }),
});

export const pendingNeeds = (needs: TWorkflowMappingNeed[]) => needs.filter((need) => need.auto_status_id === null);

export const mergeArrivals = (arrivals: Record<string, string>, needs: TWorkflowMappingNeed[]) => {
  const keys = new Set(needs.map(needKey));
  return Object.fromEntries(Object.entries(arrivals).filter(([key]) => keys.has(key)));
};

export const getSchemeNeeds = (error: unknown) => {
  const needs = (error as { needs?: unknown } | null)?.needs;
  return Array.isArray(needs) ? pendingNeeds(needs as TWorkflowMappingNeed[]) : null;
};

export const getSchemeErrorKey = (error: unknown) => {
  const code =
    typeof error === "object" && error !== null && Array.isArray((error as { scheme?: unknown }).scheme)
      ? (error as { scheme: unknown[] }).scheme[0]
      : undefined;
  return typeof code === "string" && SCHEME_ERROR_CODES.has(code)
    ? `workflows.scheme.errors.${code}`
    : "workflows.scheme.errors.default";
};
