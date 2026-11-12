/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type {
  TStateGroups,
  TWorkflowDetail,
  TWorkflowGraphPayload,
  TWorkflowRestrictActorsParams,
  TWorkflowRule,
  TWorkflowStatus,
  TWorkflowStatusUsage,
} from "@plane/types";

/** group null: the server deduces it (W5). shared_count: other workflows using the status (W17). */
export type TDraftStatus = {
  id?: string;
  name: string;
  color: string;
  group: TStateGroups | null;
  shared_count: number;
};
export type TDraftState = {
  key: string;
  status: TDraftStatus;
  position_x: number;
  position_y: number;
  is_initial: boolean;
};
export type TDraftTransition = {
  key: string;
  name: string;
  from_any: boolean;
  source_keys: string[];
  target_key: string;
  rules: TWorkflowRule[];
};
export type TDraftGraph = { states: TDraftState[]; transitions: TDraftTransition[] };

const RESERVED_STATUS_NAMES = new Set(["triage"]);
const GRAPH_ERROR_CODES = new Set([
  "initial_state_required",
  "duplicate_state_key",
  "duplicate_status",
  "duplicate_status_name",
  "invalid_transition",
  "reserved_status_name",
  "invalid_rule",
  "invalid_status",
  "status_changed",
  "status_limit",
  "status_in_use",
]);

export const fromDetail = (detail: TWorkflowDetail, statuses: TWorkflowStatus[]): TDraftGraph => ({
  states: detail.states.map((state) => {
    const usage = statuses.find((status) => status.id === state.status.id)?.workflow_count ?? 1;
    return {
      key: state.id,
      status: {
        id: state.status.id,
        name: state.status.name,
        color: state.status.color,
        group: state.status.group_is_auto ? null : state.status.group,
        shared_count: Math.max(usage - 1, 0),
      },
      position_x: state.position_x,
      position_y: state.position_y,
      is_initial: state.is_initial,
    };
  }),
  transitions: detail.transitions.map((transition) => ({
    key: transition.id,
    name: transition.name,
    from_any: transition.from_any,
    source_keys: [...transition.source_ids],
    target_key: transition.target_id,
    rules: transition.rules,
  })),
});

export const toPayload = (draft: TDraftGraph): TWorkflowGraphPayload => ({
  states: draft.states.map((state) => ({
    key: state.key,
    status: {
      ...(state.status.id ? { id: state.status.id } : {}),
      name: state.status.name.trim(),
      color: state.status.color,
      group: state.status.group,
    },
    position_x: state.position_x,
    position_y: state.position_y,
    is_initial: state.is_initial,
  })),
  transitions: draft.transitions.map((transition) => ({
    name: transition.name.trim(),
    from_any: transition.from_any,
    source_keys: transition.from_any ? [] : transition.source_keys,
    target_key: transition.target_key,
    rules: transition.rules,
  })),
});

export const isDraftDirty = (draft: TDraftGraph, saved: TDraftGraph) =>
  JSON.stringify(toPayload(draft)) !== JSON.stringify(toPayload(saved));

export const addState = (draft: TDraftGraph, key: string, status: TDraftStatus): TDraftGraph => {
  const index = draft.states.length;
  return {
    ...draft,
    states: [
      ...draft.states,
      // A new box lands on a 4-column grid; the admin can drag it afterwards.
      { key, status, position_x: (index % 4) * 240, position_y: Math.floor(index / 4) * 160, is_initial: index === 0 },
    ],
  };
};

export const setInitial = (draft: TDraftGraph, key: string): TDraftGraph => ({
  ...draft,
  states: draft.states.map((state) => ({ ...state, is_initial: state.key === key })),
});

export const removeState = (draft: TDraftGraph, key: string): TDraftGraph => {
  const removed = draft.states.find((state) => state.key === key);
  let states = draft.states.filter((state) => state.key !== key);
  if (removed?.is_initial && states.length > 0)
    states = states.map((state, index) => ({ ...state, is_initial: index === 0 }));
  const transitions = draft.transitions
    .filter((transition) => transition.target_key !== key)
    .map((transition) =>
      Object.assign({}, transition, { source_keys: transition.source_keys.filter((source) => source !== key) })
    )
    .filter((transition) => transition.from_any || transition.source_keys.length > 0);
  return { states, transitions };
};

export const updateStatus = (draft: TDraftGraph, key: string, patch: Partial<TDraftStatus>): TDraftGraph => ({
  ...draft,
  states: draft.states.map((state) =>
    state.key === key ? { ...state, status: { ...state.status, ...patch } } : state
  ),
});

// The server refuses non-finite positions, so a bad drag value never enters the draft.
export const moveState = (draft: TDraftGraph, key: string, x: number, y: number): TDraftGraph =>
  !Number.isFinite(x) || !Number.isFinite(y)
    ? draft
    : {
        ...draft,
        states: draft.states.map((state) => (state.key === key ? { ...state, position_x: x, position_y: y } : state)),
      };

export const addTransition = (draft: TDraftGraph, transition: TDraftTransition): TDraftGraph => ({
  ...draft,
  transitions: [...draft.transitions, transition],
});

export const updateTransition = (draft: TDraftGraph, key: string, patch: Partial<TDraftTransition>): TDraftGraph => ({
  ...draft,
  transitions: draft.transitions.map((transition) =>
    transition.key === key ? { ...transition, ...patch } : transition
  ),
});

export const removeTransition = (draft: TDraftGraph, key: string): TDraftGraph => ({
  ...draft,
  transitions: draft.transitions.filter((transition) => transition.key !== key),
});

export const setRestriction = (
  draft: TDraftGraph,
  transitionKey: string,
  params: TWorkflowRestrictActorsParams | null
): TDraftGraph =>
  updateTransition(draft, transitionKey, { rules: params ? [{ type: "restrict_actors", params }] : [] });

const isRuleComplete = ({ params }: TWorkflowRule) =>
  (params.roles?.length ?? 0) > 0 ||
  (params.user_ids?.length ?? 0) > 0 ||
  params.assignee === true ||
  params.creator === true;

/** Same checks as the server (Task 4), so the admin sees them before saving. */
export const validateDraft = (draft: TDraftGraph): string[] => {
  const errors = new Set<string>();
  const keys = new Set(draft.states.map((state) => state.key));
  const names = draft.states.map((state) => state.status.name.trim().toLowerCase());
  if (names.some((name) => name === "")) errors.add("invalid_status");
  if (names.some((name) => RESERVED_STATUS_NAMES.has(name))) errors.add("reserved_status_name");
  if (new Set(names).size !== names.length) errors.add("duplicate_status_name");
  const ids = draft.states.flatMap((state) => (state.status.id ? [state.status.id] : []));
  if (new Set(ids).size !== ids.length) errors.add("duplicate_status");
  if (draft.states.length > 0 && draft.states.filter((state) => state.is_initial).length !== 1)
    errors.add("initial_state_required");
  for (const transition of draft.transitions) {
    const sources = transition.from_any ? [] : transition.source_keys;
    if (
      !keys.has(transition.target_key) ||
      sources.some((source) => !keys.has(source) || source === transition.target_key) ||
      (!transition.from_any && sources.length === 0)
    )
      errors.add("invalid_transition");
    if (!transition.rules.every(isRuleComplete)) errors.add("invalid_rule");
  }
  return [...errors];
};

export const getGraphErrorKey = (error: unknown): { key: string; projects: TWorkflowStatusUsage[] } => {
  const record = typeof error === "object" && error !== null ? (error as Record<string, unknown>) : {};
  const code = Array.isArray(record.graph) ? record.graph[0] : undefined;
  const projects = Array.isArray(record.projects) ? (record.projects as TWorkflowStatusUsage[]) : [];
  if (typeof code === "string" && GRAPH_ERROR_CODES.has(code))
    return { key: `workflows.editor.errors.${code}`, projects };
  return { key: "workflows.editor.errors.default", projects: [] };
};
