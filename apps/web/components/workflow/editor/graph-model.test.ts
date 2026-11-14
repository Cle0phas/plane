/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import type { TWorkflowDetail } from "@plane/types";
import {
  addTransition,
  fromDetail,
  getDraftErrorKey,
  getGraphErrorKey,
  isDraftDirty,
  moveState,
  removeSource,
  removeState,
  routeLabel,
  setInitial,
  shouldResetDraft,
  stateName,
  updateTransition,
  setRestriction,
  toPayload,
  updateStatus,
  validateDraft,
  type TDraftGraph,
} from "./graph-model";

const detail: TWorkflowDetail = {
  id: "w",
  name: "Flow",
  description: "",
  updated_at: null,
  project_count: 0,
  states: [
    {
      id: "a",
      status: { id: "sa", name: "Open", color: "#111111", group: "unstarted", group_is_auto: true },
      position_x: 0,
      position_y: 0,
      is_initial: true,
    },
    {
      id: "b",
      status: { id: "sb", name: "Done", color: "#222222", group: "cancelled", group_is_auto: false },
      position_x: 240,
      position_y: 0,
      is_initial: false,
    },
  ],
  transitions: [{ id: "t", name: "Finish", from_any: false, source_ids: ["a"], target_id: "b", rules: [] }],
};
const statuses = [
  { id: "sa", name: "Open", color: "#111111", group: "unstarted" as const, group_is_auto: true, workflow_count: 2 },
  { id: "sb", name: "Done", color: "#222222", group: "cancelled" as const, group_is_auto: false, workflow_count: 1 },
];

describe("graph model", () => {
  it("round-trips the server graph and keeps auto groups automatic", () => {
    const draft = fromDetail(detail, statuses);
    expect(draft.states[0].status).toEqual({
      id: "sa",
      name: "Open",
      color: "#111111",
      group: null,
      known_group: "unstarted",
      group_locked: false,
      shared_count: 1,
    });
    expect(draft.states[1].status.group).toBe("cancelled");
    // Set by hand on the server: the server ignores a return to automatic (W5).
    expect(draft.states[1].status.group_locked).toBe(true);
    expect(toPayload(draft)).toEqual({
      states: [
        {
          key: "a",
          status: { id: "sa", name: "Open", color: "#111111", group: null },
          position_x: 0,
          position_y: 0,
          is_initial: true,
        },
        {
          key: "b",
          status: { id: "sb", name: "Done", color: "#222222", group: "cancelled" },
          position_x: 240,
          position_y: 0,
          is_initial: false,
        },
      ],
      transitions: [{ name: "Finish", from_any: false, source_keys: ["a"], target_key: "b", rules: [], sides: {} }],
    });
  });

  it("keeps the hand-set flag out of the payload and of the dirty check", () => {
    const draft = fromDetail(detail, statuses);
    const flipped: TDraftGraph = {
      ...draft,
      states: draft.states.map((item) => ({
        ...item,
        status: { ...item.status, group_locked: !item.status.group_locked },
      })),
    };
    expect(toPayload(flipped)).toEqual(toPayload(draft));
    expect(isDraftDirty(flipped, draft)).toBe(false);
  });

  it("removing a state drops its arrows and hands the initial flag over", () => {
    let draft: TDraftGraph = fromDetail(detail, statuses);
    draft = addTransition(draft, { key: "g", name: "", from_any: true, source_keys: [], target_key: "a", rules: [] });
    const without = removeState(draft, "a");
    expect(without.states.map((state) => state.key)).toEqual(["b"]);
    expect(without.states[0].is_initial).toBe(true);
    expect(without.transitions).toEqual([]);
  });

  it("does not mutate the previous draft", () => {
    const draft = fromDetail(detail, statuses);
    const renamed = updateStatus(draft, "a", { name: "Ready" });
    expect(draft.states[0].status.name).toBe("Open");
    expect(renamed.states[0].status.name).toBe("Ready");
    expect(isDraftDirty(renamed, draft)).toBe(true);
    expect(isDraftDirty(fromDetail(detail, statuses), draft)).toBe(false);
  });

  it("sets and clears a restriction", () => {
    const draft = fromDetail(detail, statuses);
    const restricted = setRestriction(draft, "t", { roles: [20], creator: true });
    expect(restricted.transitions[0].rules).toEqual([
      { type: "restrict_actors", params: { roles: [20], creator: true } },
    ]);
    expect(setRestriction(restricted, "t", null).transitions[0].rules).toEqual([]);
  });

  it("validates like the server", () => {
    const draft = fromDetail(detail, statuses);
    expect(validateDraft(draft)).toEqual([]);
    expect(validateDraft(updateStatus(draft, "b", { name: "open" }))).toContain("duplicate_status_name");
    expect(validateDraft(updateStatus(draft, "b", { name: "Triage" }))).toContain("reserved_status_name");
    expect(
      validateDraft(
        addTransition(draft, { key: "x", name: "", from_any: false, source_keys: [], target_key: "b", rules: [] })
      )
    ).toContain("invalid_transition");
    expect(validateDraft(setRestriction(draft, "t", {}))).toContain("invalid_rule");
    expect(validateDraft(setInitial(draft, "none"))).toContain("initial_state_required");
  });

  it("ignores non-finite positions and flags empty names", () => {
    const draft = fromDetail(detail, statuses);
    expect(moveState(draft, "a", Number.NaN, 5)).toBe(draft);
    expect(moveState(draft, "a", 10, 20).states[0]).toMatchObject({ position_x: 10, position_y: 20 });
    expect(validateDraft(updateStatus(draft, "b", { name: "  " }))).toContain("status_name_required");
  });

  it("maps server errors to i18n keys", () => {
    const usage = [{ project_id: "p", project_name: "Home", issue_count: 2 }];
    expect(getGraphErrorKey({ graph: ["status_in_use"], projects: usage })).toEqual({
      key: "workflows.editor.errors.status_in_use",
      projects: usage,
    });
    expect(getGraphErrorKey({ graph: ["<b>"] })).toEqual({ key: "workflows.editor.errors.default", projects: [] });
    expect(getGraphErrorKey(undefined).key).toBe("workflows.editor.errors.default");
  });

  it("flags duplicate sources and several rules like the server", () => {
    const draft = fromDetail(detail, statuses);
    const dup = updateTransition(draft, "t", { source_keys: ["a", "a"] });
    expect(validateDraft(dup)).toContain("invalid_transition");
    const rule = { type: "restrict_actors" as const, params: { creator: true as const } };
    expect(validateDraft(updateTransition(draft, "t", { rules: [rule, rule] }))).toContain("invalid_rule");
  });

  it("does not alias rules of the store data", () => {
    const withRule: TWorkflowDetail = {
      ...detail,
      transitions: [{ ...detail.transitions[0], rules: [{ type: "restrict_actors", params: { roles: [20] } }] }],
    };
    const draft = fromDetail(withRule, statuses);
    expect(draft.transitions[0].rules[0]).not.toBe(withRule.transitions[0].rules[0]);
    expect(draft.transitions[0].rules[0].params).not.toBe(withRule.transitions[0].rules[0].params);
    const params = { roles: [10] };
    expect(setRestriction(draft, "t", params).transitions[0].rules[0].params).not.toBe(params);
  });

  it("maps draft codes to i18n keys", () => {
    expect(getDraftErrorKey("status_name_required")).toBe("work_item_types.create_update.form.name.required");
    expect(getDraftErrorKey("invalid_rule")).toBe("workflows.editor.errors.invalid_rule");
  });
});

describe("shouldResetDraft", () => {
  const saved = fromDetail(detail, []);
  const refreshed = updateStatus(saved, saved.states[0].key, { color: "#123456" });

  it("takes a changed saved graph when the draft is clean", () => {
    expect(shouldResetDraft(saved, refreshed, saved)).toBe(true);
  });
  it("keeps unsaved edits when the saved graph changed", () => {
    const edited = moveState(saved, saved.states[0].key, 999, 999);
    expect(shouldResetDraft(saved, refreshed, edited)).toBe(false);
  });
  it("ignores an unchanged saved graph", () => {
    expect(shouldResetDraft(saved, fromDetail(detail, []), saved)).toBe(false);
  });
});

describe("labels", () => {
  it("names a state by its key, and an unknown key with an empty name", () => {
    const draft = fromDetail(detail, statuses);
    expect(stateName(draft, "b")).toBe("Done");
    expect(stateName(draft, "gone")).toBe("");
  });
  it("joins the origin and the target of a route with an arrow", () => {
    expect(routeLabel("Open, Doing", "Done")).toBe("Open, Doing → Done");
  });
});

describe("removeSource", () => {
  const draft: TDraftGraph = {
    states: [],
    transitions: [
      {
        key: "t",
        name: "Finish",
        from_any: false,
        source_keys: ["a", "b"],
        target_key: "c",
        rules: [],
        sides: { a: { source: "right", target: "left" }, b: { source: "top", target: "bottom" } },
      },
      { key: "u", name: "", from_any: false, source_keys: ["a", "b"], target_key: "d", rules: [] },
    ],
  };

  it("drops one source and its sides, and leaves the other transitions alone", () => {
    const next = removeSource(draft, "t", "a");
    expect(next.transitions[0]).toEqual({
      ...draft.transitions[0],
      source_keys: ["b"],
      sides: { b: draft.transitions[0].sides?.b },
    });
    expect(next.transitions[1]).toBe(draft.transitions[1]);
  });

  it("keeps the last source: a transition from states needs one", () => {
    const once = removeSource(draft, "t", "a");
    expect(removeSource(once, "t", "b").transitions[0].source_keys).toEqual(["b"]);
  });
});
