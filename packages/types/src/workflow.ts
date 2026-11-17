/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TStateGroups } from "./state";

export type TWorkflowStatus = {
  id: string;
  name: string;
  color: string;
  group: TStateGroups;
  group_is_auto: boolean;
  workflow_count?: number;
  /** Workflows using the status, sorted by name. */
  workflows?: { id: string; name: string }[];
};

export type TWorkflowRestrictActorsParams = {
  roles?: number[];
  user_ids?: string[];
  assignee?: true;
  creator?: true;
};

export type TWorkflowRule = { type: "restrict_actors"; params: TWorkflowRestrictActorsParams };

export type TWorkflowSide = "top" | "right" | "bottom" | "left";

/** Sides an arrow leaves and enters by, keyed by source state id (response) or source key (payload). */
export type TWorkflowSides = Record<string, { source: TWorkflowSide; target: TWorkflowSide }>;

export type TWorkflowStatusCandidate = { name: string; color: string; group: TStateGroups };

export type TWorkflowState = {
  id: string;
  status: TWorkflowStatus;
  position_x: number;
  position_y: number;
  is_initial: boolean;
};

export type TWorkflowTransition = {
  id: string;
  name: string;
  from_any: boolean;
  source_ids: string[];
  target_id: string;
  rules: TWorkflowRule[];
  sides?: TWorkflowSides;
};

export type TWorkflowProjectRef = { id: string; name: string };

export type TWorkflowGraph = {
  id: string;
  name: string;
  description: string;
  updated_at: string | null;
  states: TWorkflowState[];
  transitions: TWorkflowTransition[];
};

export type TWorkflowDetail = TWorkflowGraph & {
  /** Fingerprint of the graph, sent back with a save (stale save refused). */
  version: string;
  project_count: number;
  projects?: TWorkflowProjectRef[];
};

export type TWorkflowSummary = {
  id: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
  state_count: number;
  project_count: number;
  projects?: TWorkflowProjectRef[];
};

export type TWorkflowFormData = { name: string; description?: string; source_project_id?: string };

export type TWorkflowGraphPayloadState = {
  key: string;
  status: { id?: string; name: string; color: string; group?: TStateGroups | null };
  position_x: number;
  position_y: number;
  is_initial: boolean;
};

export type TWorkflowGraphPayloadTransition = {
  name: string;
  from_any: boolean;
  source_keys: string[];
  target_key: string;
  rules: TWorkflowRule[];
  sides?: TWorkflowSides;
};

export type TWorkflowGraphPayload = {
  states: TWorkflowGraphPayloadState[];
  transitions: TWorkflowGraphPayloadTransition[];
};

export type TWorkflowGraphSavePayload = TWorkflowGraphPayload & { expected_version: string };

/** Another workspace admin with unsaved changes on the same workflow. */
export type TWorkflowEditor = { id: string; display_name: string };

export type TProjectWorkflowSchemeItem = { issue_type_id: string; workflow_id: string };

export type TProjectWorkflowScheme = {
  default_workflow_id: string | null;
  items: TProjectWorkflowSchemeItem[];
  workflows: TWorkflowGraph[];
};

export type TWorkflowMapping = { state_id: string; workflow_id: string; status_id: string };

export type TProjectWorkflowSchemePayload = {
  default_workflow_id: string;
  items: TProjectWorkflowSchemeItem[];
  mappings?: TWorkflowMapping[];
};

export type TWorkflowMappingNeed = {
  state_id: string;
  state_name: string;
  workflow_id: string;
  issue_count: number;
  auto_status_id: string | null;
};

export type TWorkflowStatusUsage = { project_id: string; project_name: string; issue_count: number };
