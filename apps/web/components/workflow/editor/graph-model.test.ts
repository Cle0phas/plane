/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import type { TWorkflowDetail } from "@plane/types";
import {
  addState,
  addTransition,
  fromDetail,
  getGraphErrorKey,
  isDraftDirty,
  moveState,
  removeState,
  setInitial,
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
const newStatus = { name: "Review", color: "#333333", group: null, shared_count: 0 };

describe("graph model", () => {
  it("round-trips the server graph and keeps auto groups automatic", () => {
    const draft = fromDetail(detail, statuses);
    expect(draft.states[0].status).toEqual({ id: "sa", name: "Open", color: "#111111", group: null, shared_count: 1 });
    expect(draft.states[1].status.group).toBe("cancelled");
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
      transitions: [{ name: "Finish", from_any: false, source_keys: ["a"], target_key: "b", rules: [] }],
    });
  });

  it("makes the first state initial and keeps exactly one initial", () => {
    const first = addState({ states: [], transitions: [] }, "n1", newStatus);
    expect(first.states[0].is_initial).toBe(true);
    const second = setInitial(addState(first, "n2", { ...newStatus, name: "Other" }), "n2");
    expect(second.states.filter((state) => state.is_initial).map((state) => state.key)).toEqual(["n2"]);
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
    expect(validateDraft(updateStatus(draft, "b", { name: "  " }))).toContain("invalid_status");
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
});
