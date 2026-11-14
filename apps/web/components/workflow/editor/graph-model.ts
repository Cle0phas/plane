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
  TWorkflowSide,
  TWorkflowSides,
  TWorkflowStatus,
  TWorkflowStatusCandidate,
  TWorkflowStatusUsage,
} from "@plane/types";

/**
 * group null: the server deduces it (W5). known_group: category already known, display only (X5).
 * shared_count: other workflows using the status (W17).
 */
export type TDraftStatus = {
  id?: string;
  name: string;
  color: string;
  group: TStateGroups | null;
  known_group?: TStateGroups;
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
  /** Sides chosen while drawing, keyed by source key; a missing entry means automatic. */
  sides?: TWorkflowSides;
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
        known_group: state.status.group,
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
    rules: transition.rules.map((rule) => ({ ...rule, params: { ...rule.params } })),
    sides: Object.fromEntries(Object.entries(transition.sides ?? {}).map(([key, pair]) => [key, { ...pair }])),
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
    // Only the sides of sources the transition still has are sent.
    sides: Object.fromEntries(
      Object.entries(transition.sides ?? {}).filter(
        ([key]) => !transition.from_any && transition.source_keys.includes(key)
      )
    ),
  })),
});

export const isDraftDirty = (draft: TDraftGraph, saved: TDraftGraph) =>
  JSON.stringify(toPayload(draft)) !== JSON.stringify(toPayload(saved));

// Take a refreshed saved graph only when its content changed and the user holds no unsaved edit.
export const shouldResetDraft = (previousSaved: TDraftGraph, saved: TDraftGraph, draft: TDraftGraph) =>
  JSON.stringify(previousSaved) !== JSON.stringify(saved) && !isDraftDirty(draft, previousSaved);

export const PLACEMENT_STEP = 240;

export type TNewState = { key: string; status: TDraftStatus; globalKey?: string };

// New states line up right of the last one (R12); globalKey adds a transition from any state.
export const addStates = (draft: TDraftGraph, entries: TNewState[]): TDraftGraph => {
  const last = draft.states[draft.states.length - 1];
  const hasInitial = draft.states.some((state) => state.is_initial);
  const states = entries.map((entry, index) => ({
    key: entry.key,
    status: entry.status,
    position_x: last ? last.position_x + (index + 1) * PLACEMENT_STEP : index * PLACEMENT_STEP,
    position_y: last?.position_y ?? 0,
    is_initial: !hasInitial && index === 0,
  }));
  const transitions = entries.flatMap((entry) =>
    entry.globalKey
      ? [
          {
            key: entry.globalKey,
            name: "",
            from_any: true,
            source_keys: [],
            target_key: entry.key,
            rules: [],
            sides: {},
          },
        ]
      : []
  );
  return { states: [...draft.states, ...states], transitions: [...draft.transitions, ...transitions] };
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

// Choosing a category (or automatic) drops known_group so the display never shows a stale one.
export const updateStatus = (draft: TDraftGraph, key: string, patch: Partial<TDraftStatus>): TDraftGraph => ({
  ...draft,
  states: draft.states.map((state) => {
    if (state.key !== key) return state;
    const status = { ...state.status, ...patch };
    if ("group" in patch) delete status.known_group;
    return { ...state, status };
  }),
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
  updateTransition(draft, transitionKey, {
    rules: params ? [{ type: "restrict_actors", params: { ...params } }] : [],
  });

export const isRuleComplete = ({ params }: TWorkflowRule) =>
  (params.roles?.length ?? 0) > 0 ||
  (params.user_ids?.length ?? 0) > 0 ||
  params.assignee === true ||
  params.creator === true;

/** Same checks as the server (Task 4), so the admin sees them before saving. */
export const validateDraft = (draft: TDraftGraph): string[] => {
  const errors = new Set<string>();
  const keys = new Set(draft.states.map((state) => state.key));
  const names = draft.states.map((state) => state.status.name.trim().toLowerCase());
  if (names.some((name) => name === "")) errors.add("status_name_required");
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
      new Set(sources).size !== sources.length ||
      sources.some((source) => !keys.has(source) || source === transition.target_key) ||
      (!transition.from_any && sources.length === 0)
    )
      errors.add("invalid_transition");
    if (transition.rules.length > 1 || !transition.rules.every(isRuleComplete)) errors.add("invalid_rule");
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

const DRAFT_ERROR_KEYS: Record<string, string> = {
  status_name_required: "work_item_types.create_update.form.name.required",
};

/** i18n key for a validateDraft code; status_name_required is client only. */
export const getDraftErrorKey = (code: string): string => DRAFT_ERROR_KEYS[code] ?? `workflows.editor.errors.${code}`;

type TPoint = { x: number; y: number };

// Sides for an arrow not drawn by hand: the pair facing each other.
export const closestSides = (source: TPoint, target: TPoint): { source: TWorkflowSide; target: TWorkflowSide } => {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  if (Math.abs(dx) >= Math.abs(dy))
    return dx >= 0 ? { source: "right", target: "left" } : { source: "left", target: "right" };
  return dy >= 0 ? { source: "bottom", target: "top" } : { source: "top", target: "bottom" };
};

export const connectStates = (
  draft: TDraftGraph,
  key: string,
  sourceKey: string,
  sourceSide: TWorkflowSide,
  targetKey: string,
  targetSide: TWorkflowSide
): TDraftGraph => {
  const known = (stateKey: string) => draft.states.some((state) => state.key === stateKey);
  if (sourceKey === targetKey || !known(sourceKey) || !known(targetKey)) return draft;
  return addTransition(draft, {
    key,
    name: "",
    from_any: false,
    source_keys: [sourceKey],
    target_key: targetKey,
    rules: [],
    sides: { [sourceKey]: { source: sourceSide, target: targetSide } },
  });
};

/** Category shown for a state: chosen, else known, else deduced like the server does (W5, X5). */
export const displayGroup = (draft: TDraftGraph, state: TDraftState): TStateGroups => {
  if (state.status.group) return state.status.group;
  if (state.status.known_group) return state.status.known_group;
  if (state.is_initial) return "unstarted";
  const leaves = draft.transitions.some(
    (transition) => !transition.from_any && transition.source_keys.includes(state.key)
  );
  return leaves ? "started" : "completed";
};

export type TStateTone = "todo" | "progress" | "done" | "cancelled";

export const toneOf = (group: TStateGroups): TStateTone => {
  if (group === "started") return "progress";
  if (group === "completed") return "done";
  if (group === "cancelled") return "cancelled";
  return "todo";
};

/** Colour given to a status created in the editor: the default Plane colour of its category. */
export const GROUP_COLORS: Record<TStateGroups, string> = {
  backlog: "#A3A3A3",
  unstarted: "#3A3A3A",
  started: "#F59E0B",
  completed: "#16A34A",
  cancelled: "#EF4444",
};

export type TStatusOption = {
  id?: string;
  name: string;
  color: string;
  group: TStateGroups;
  group_is_auto: boolean;
  workflow_count: number;
};

/** "Search or create" list (R7): workspace statuses, then project states, minus names already used. */
export const statusOptions = (
  statuses: TWorkflowStatus[],
  candidates: TWorkflowStatusCandidate[],
  draft: TDraftGraph
): TStatusOption[] => {
  const seen = new Set(draft.states.map((state) => state.status.name.trim().toLowerCase()));
  // A renamed status keeps its id: it must stay out of the list even though its name changed.
  const usedIds = new Set(draft.states.flatMap((state) => (state.status.id ? [state.status.id] : [])));
  const all: TStatusOption[] = [
    ...statuses.map((item) => ({
      id: item.id,
      name: item.name,
      color: item.color,
      group: item.group,
      group_is_auto: item.group_is_auto,
      workflow_count: item.workflow_count ?? 0,
    })),
    ...candidates.map((item) => ({ ...item, group_is_auto: false, workflow_count: 0 })),
  ];
  return all.filter((option) => {
    const key = option.name.trim().toLowerCase();
    // The server name of a used status stays reserved, so a same-named project state is not offered.
    const known = seen.has(key);
    seen.add(key);
    return !known && !(option.id && usedIds.has(option.id));
  });
};

export const optionToStatus = (option: TStatusOption): TDraftStatus => ({
  ...(option.id ? { id: option.id } : {}),
  name: option.name,
  color: option.color,
  group: option.group_is_auto ? null : option.group,
  known_group: option.group,
  shared_count: option.workflow_count,
});

export const createdStatus = (name: string, group: TStateGroups | null): TDraftStatus => ({
  name: name.trim(),
  color: GROUP_COLORS[group ?? "unstarted"],
  group,
  shared_count: 0,
});

export const statusNameError = (
  name: string,
  draft: TDraftGraph
): "required" | "too_long" | "reserved" | "present" | null => {
  const key = name.trim().toLowerCase();
  if (!key) return "required";
  if (key.length > 255) return "too_long";
  if (RESERVED_STATUS_NAMES.has(key)) return "reserved";
  if (draft.states.some((state) => state.status.name.trim().toLowerCase() === key)) return "present";
  return null;
};

export const transitionCounts = (draft: TDraftGraph, key: string) => ({
  incoming: draft.transitions.filter((transition) => transition.target_key === key).length,
  outgoing: draft.transitions.filter((transition) => !transition.from_any && transition.source_keys.includes(key))
    .length,
});

export type TTextTransition = {
  key: string | null;
  name: string;
  origin: "start" | "any" | "state";
  sourceName?: string;
};
export type TTextRow = { key: string; name: string; group: TStateGroups; transitions: TTextTransition[] };

/** Text view (spec 3.7): each state with the transitions that lead to it, the start first. */
export const textRows = (draft: TDraftGraph): TTextRow[] => {
  const nameOf = (key: string) => draft.states.find((state) => state.key === key)?.status.name ?? "";
  return draft.states.map((state) => ({
    key: state.key,
    name: state.status.name,
    group: displayGroup(draft, state),
    transitions: [
      ...(state.is_initial ? [{ key: null, name: "", origin: "start" as const }] : []),
      ...draft.transitions
        .filter((transition) => transition.target_key === state.key)
        .flatMap((transition): TTextTransition[] =>
          transition.from_any
            ? [{ key: transition.key, name: transition.name, origin: "any" }]
            : transition.source_keys.map((source) => ({
                key: transition.key,
                name: transition.name,
                origin: "state",
                sourceName: nameOf(source),
              }))
        ),
    ],
  }));
};

/** First free name among base, "base (2)", "base (3)"..., kept within 255 characters (spec 4.3). */
export const uniqueName = (base: string, taken: string[]): string => {
  const used = new Set(taken.map((name) => name.trim().toLowerCase()));
  for (let index = 1; ; index += 1) {
    const suffix = index === 1 ? "" : ` (${index})`;
    const candidate = `${base
      .trim()
      .slice(0, 255 - suffix.length)
      .trimEnd()}${suffix}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
};
