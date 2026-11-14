/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import type { TWorkflowDetail, TWorkflowStatus } from "@plane/types";
import {
  addStates,
  closestSides,
  connectStates,
  createdStatus,
  displayGroup,
  errorTarget,
  fromDetail,
  optionToStatus,
  setInitial,
  startPlacement,
  statusNameError,
  statusOptions,
  textRows,
  toneOf,
  toPayload,
  updateStatus,
  transitionCounts,
  uniqueName,
  type TDraftGraph,
  type TDraftState,
  type TDraftStatus,
} from "./graph-model";

const status = (name: string, extra: Partial<TDraftStatus> = {}): TDraftStatus => ({
  name,
  color: "#3A3A3A",
  group: null,
  shared_count: 0,
  ...extra,
});
const state = (key: string, extra: Partial<TDraftState> = {}): TDraftState => ({
  key,
  status: status(key),
  position_x: 0,
  position_y: 0,
  is_initial: false,
  ...extra,
});
const EMPTY: TDraftGraph = { states: [], transitions: [] };

describe("addStates", () => {
  it("starts a row at the origin and makes the first state initial", () => {
    const draft = addStates(EMPTY, [
      { key: "a", status: status("A") },
      { key: "b", status: status("B") },
    ]);
    expect(draft.states.map((item) => [item.key, item.position_x, item.position_y, item.is_initial])).toEqual([
      ["a", 0, 0, true],
      ["b", 240, 0, false],
    ]);
  });

  it("lines new states up to the right of the last one", () => {
    const base: TDraftGraph = {
      states: [state("a", { position_x: 100, position_y: 50, is_initial: true })],
      transitions: [],
    };
    const draft = addStates(base, [
      { key: "b", status: status("B") },
      { key: "c", status: status("C") },
    ]);
    expect(draft.states.slice(1).map((item) => [item.position_x, item.position_y, item.is_initial])).toEqual([
      [340, 50, false],
      [580, 50, false],
    ]);
  });

  // R12 on a diagram rearranged by hand: the place right of the last state can already be taken.
  it("moves a new state further right while its place is taken by a state", () => {
    const base: TDraftGraph = {
      states: [state("b", { position_x: 240 }), state("d", { position_x: 730, position_y: 30 }), state("a")],
      transitions: [],
    };
    const draft = addStates(base, [
      { key: "x", status: status("X") },
      { key: "y", status: status("Y") },
    ]);
    expect(draft.states.slice(3).map((item) => [item.key, item.position_x, item.position_y])).toEqual([
      ["x", 480, 0],
      ["y", 960, 0],
    ]);
  });

  it("makes a state initial only when the draft has none", () => {
    const withInitial: TDraftGraph = { states: [state("a", { is_initial: true })], transitions: [] };
    expect(addStates(withInitial, [{ key: "b", status: status("B") }]).states[1].is_initial).toBe(false);
    const withoutInitial: TDraftGraph = { states: [state("a")], transitions: [] };
    expect(addStates(withoutInitial, [{ key: "b", status: status("B") }]).states[1].is_initial).toBe(true);
  });

  it("keeps exactly one initial state after setInitial", () => {
    const draft = setInitial(
      addStates(EMPTY, [
        { key: "a", status: status("A") },
        { key: "b", status: status("B") },
      ]),
      "b"
    );
    expect(draft.states.filter((item) => item.is_initial).map((item) => item.key)).toEqual(["b"]);
  });

  it("adds a transition from any state when a global key is given", () => {
    const draft = addStates(EMPTY, [{ key: "a", status: status("A"), globalKey: "g" }]);
    expect(draft.transitions).toEqual([
      { key: "g", name: "", from_any: true, source_keys: [], target_key: "a", rules: [], sides: {} },
    ]);
  });
});

describe("sides", () => {
  it("picks the closest pair of sides", () => {
    expect(closestSides({ x: 0, y: 0 }, { x: 300, y: 40 })).toEqual({ source: "right", target: "left" });
    expect(closestSides({ x: 300, y: 0 }, { x: 0, y: 40 })).toEqual({ source: "left", target: "right" });
    expect(closestSides({ x: 0, y: 0 }, { x: 40, y: 300 })).toEqual({ source: "bottom", target: "top" });
    expect(closestSides({ x: 0, y: 300 }, { x: 40, y: 0 })).toEqual({ source: "top", target: "bottom" });
  });

  it("records the sides of a drawn arrow and refuses a loop or an unknown state", () => {
    const base: TDraftGraph = { states: [state("a"), state("b")], transitions: [] };
    const draft = connectStates(base, "t", "a", "top", "b", "bottom");
    expect(draft.transitions).toEqual([
      {
        key: "t",
        name: "",
        from_any: false,
        source_keys: ["a"],
        target_key: "b",
        rules: [],
        sides: { a: { source: "top", target: "bottom" } },
      },
    ]);
    expect(connectStates(base, "t", "a", "top", "a", "bottom")).toBe(base);
    expect(connectStates(base, "t", "a", "top", "zz", "bottom")).toBe(base);
  });

  it("round-trips sides and drops those of a removed source", () => {
    const detail: TWorkflowDetail = {
      id: "w",
      name: "W",
      description: "",
      updated_at: null,
      project_count: 0,
      states: [
        {
          id: "a",
          status: { id: "sa", name: "A", color: "#3A3A3A", group: "started", group_is_auto: true },
          position_x: 0,
          position_y: 0,
          is_initial: true,
        },
        {
          id: "b",
          status: { id: "sb", name: "B", color: "#3A3A3A", group: "completed", group_is_auto: false },
          position_x: 240,
          position_y: 0,
          is_initial: false,
        },
      ],
      transitions: [
        {
          id: "t",
          name: "",
          from_any: false,
          source_ids: ["a"],
          target_id: "b",
          rules: [],
          sides: { a: { source: "right", target: "left" } },
        },
      ],
    };
    const draft = fromDetail(detail, []);
    expect(draft.states[0].status.known_group).toBe("started");
    expect(toPayload(draft).transitions[0].sides).toEqual({ a: { source: "right", target: "left" } });
    const edited = {
      ...draft,
      transitions: [
        {
          ...draft.transitions[0],
          sides: { a: { source: "top", target: "left" }, gone: { source: "top", target: "left" } },
        },
      ],
    };
    const source = { a: { source: "right" as const, target: "left" as const } };
    const copied = fromDetail({ ...detail, transitions: [{ ...detail.transitions[0], sides: source }] }, []);
    expect(copied.transitions[0].sides?.a).not.toBe(source.a);
    expect(toPayload(edited as TDraftGraph).transitions[0].sides).toEqual({ a: { source: "top", target: "left" } });
  });
});

describe("startPlacement", () => {
  const at = (key: string, x: number, y: number, isInitial = false) =>
    state(key, { position_x: x, position_y: y, is_initial: isInitial });

  it("places nothing without an initial state", () => {
    expect(startPlacement({ states: [at("a", 0, 0)], transitions: [] })).toBeNull();
  });

  it("goes to the left of the initial state when that place is free", () => {
    const draft: TDraftGraph = { states: [at("a", 0, 0, true), at("b", 240, 0)], transitions: [] };
    expect(startPlacement(draft)).toEqual({ x: -160, y: -20, sides: { source: "right", target: "left" } });
  });

  it("goes above the initial state when a state sits on its left", () => {
    const draft: TDraftGraph = { states: [at("a", 0, 0), at("b", 240, 0, true)], transitions: [] };
    expect(startPlacement(draft)).toEqual({ x: 264, y: -160, sides: { source: "bottom", target: "top" } });
  });

  it("goes below the initial state when its left and its top are taken", () => {
    const draft: TDraftGraph = {
      states: [at("a", 0, 0), at("b", 240, 0, true), at("c", 240, -180)],
      transitions: [],
    };
    expect(startPlacement(draft)).toEqual({ x: 264, y: 120, sides: { source: "top", target: "bottom" } });
  });

  it("goes below as the last resort, even when a state is there too", () => {
    const draft: TDraftGraph = {
      states: [at("a", 0, 0), at("b", 240, 0, true), at("c", 240, -180), at("d", 240, 150)],
      transitions: [],
    };
    expect(startPlacement(draft)).toEqual({ x: 264, y: 120, sides: { source: "top", target: "bottom" } });
  });

  // The arrow would run over the "any state" pill drawn above the initial state.
  it("leaves the top to the any-state pill of the initial state", () => {
    const draft: TDraftGraph = {
      states: [at("a", 0, 0), at("b", 240, 0, true)],
      transitions: [{ key: "g", name: "", from_any: true, source_keys: [], target_key: "b", rules: [] }],
    };
    expect(startPlacement(draft)?.sides.target).toBe("bottom");
  });
});

describe("categories", () => {
  it("shows the chosen category, then the known one, then the deduced one", () => {
    const draft: TDraftGraph = {
      states: [
        state("chosen", { status: status("Chosen", { group: "cancelled", known_group: "started" }) }),
        state("known", { status: status("Known", { known_group: "backlog" }) }),
        state("first", { is_initial: true }),
        state("middle"),
        state("last"),
      ],
      transitions: [
        { key: "t", name: "", from_any: false, source_keys: ["middle"], target_key: "last", rules: [] },
        { key: "g", name: "", from_any: true, source_keys: [], target_key: "first", rules: [] },
      ],
    };
    expect(draft.states.map((item) => displayGroup(draft, item))).toEqual([
      "cancelled",
      "backlog",
      "unstarted",
      "started",
      "completed",
    ]);
  });

  // X5 as written: the known category stays shown until a save brings the server's deduction (W5).
  it("shows the known category again once the category is set back to automatic", () => {
    const draft: TDraftGraph = {
      states: [state("a", { is_initial: true, status: status("A", { known_group: "cancelled" }) })],
      transitions: [],
    };
    const chosen = updateStatus(draft, "a", { group: "started" });
    expect(displayGroup(chosen, chosen.states[0])).toBe("started");
    const auto = updateStatus(chosen, "a", { group: null });
    expect(auto.states[0].status.known_group).toBe("cancelled");
    expect(displayGroup(auto, auto.states[0])).toBe("cancelled");
    const fresh: TDraftGraph = { states: [state("a", { is_initial: true })], transitions: [] };
    expect(displayGroup(fresh, fresh.states[0])).toBe("unstarted");
  });

  it("maps the five categories to four tones", () => {
    expect((["backlog", "unstarted", "started", "completed", "cancelled"] as const).map(toneOf)).toEqual([
      "todo",
      "todo",
      "progress",
      "done",
      "cancelled",
    ]);
  });
});

describe("status options", () => {
  const statuses: TWorkflowStatus[] = [
    { id: "s1", name: "Todo", color: "#111111", group: "unstarted", group_is_auto: false, workflow_count: 2 },
    { id: "s2", name: "Used", color: "#222222", group: "started", group_is_auto: true, workflow_count: 1 },
  ];
  const candidates = [
    { name: "Review", color: "#333333", group: "started" as const },
    { name: "todo", color: "#444444", group: "backlog" as const },
  ];
  const draft: TDraftGraph = { states: [state("u", { status: status("used") })], transitions: [] };

  it("lists statuses then candidates, without names already in the workflow or listed twice", () => {
    expect(statusOptions(statuses, candidates, draft).map((option) => option.name)).toEqual(["Todo", "Review"]);
  });

  it("keeps a renamed status of the draft out of the list by its id", () => {
    const renamed: TDraftGraph = { states: [state("u", { status: status("Renamed", { id: "s1" }) })], transitions: [] };
    expect(statusOptions(statuses, candidates, renamed).map((option) => option.name)).toEqual(["Used", "Review"]);
  });

  it("turns an option into a draft status", () => {
    const [existing, candidate] = statusOptions(statuses, candidates, draft);
    expect(optionToStatus(existing)).toEqual({
      id: "s1",
      name: "Todo",
      color: "#111111",
      group: "unstarted",
      known_group: "unstarted",
      group_locked: true,
      shared_count: 2,
    });
    expect(optionToStatus(candidate)).toEqual({
      name: "Review",
      color: "#333333",
      group: "started",
      known_group: "started",
      group_locked: false,
      shared_count: 0,
    });
    const automatic = optionToStatus({ ...existing, group_is_auto: true });
    expect(automatic.group).toBeNull();
    expect(automatic.group_locked).toBe(false);
  });

  it("builds a created status with the colour of its category", () => {
    expect(createdStatus("  New  ", "completed")).toEqual({
      name: "New",
      color: "#16A34A",
      group: "completed",
      shared_count: 0,
    });
    expect(createdStatus("Auto", null)).toEqual({ name: "Auto", color: "#3A3A3A", group: null, shared_count: 0 });
  });

  it("explains why a name cannot be added", () => {
    expect(statusNameError("  ", draft)).toBe("required");
    expect(statusNameError("x".repeat(256), draft)).toBe("too_long");
    expect(statusNameError("Triage", draft)).toBe("reserved");
    expect(statusNameError("USED", draft)).toBe("present");
    expect(statusNameError("Fresh", draft)).toBeNull();
  });
});

describe("text view and counts", () => {
  const draft: TDraftGraph = {
    states: [state("a", { is_initial: true, status: status("A") }), state("b", { status: status("B") })],
    transitions: [
      { key: "t", name: "Go", from_any: false, source_keys: ["a"], target_key: "b", rules: [] },
      { key: "g", name: "", from_any: true, source_keys: [], target_key: "a", rules: [] },
    ],
  };

  it("lists the incoming transitions of each state, the start first", () => {
    expect(textRows(draft)).toEqual([
      {
        key: "a",
        name: "A",
        group: "unstarted",
        transitions: [
          { key: null, name: "", origin: "start" },
          { key: "g", name: "", origin: "any" },
        ],
      },
      {
        key: "b",
        name: "B",
        group: "completed",
        transitions: [{ key: "t", name: "Go", origin: "state", sourceKey: "a", sourceName: "A" }],
      },
    ]);
  });

  it("counts incoming and outgoing transitions", () => {
    expect(transitionCounts(draft, "a")).toEqual({ incoming: 1, outgoing: 1 });
    expect(transitionCounts(draft, "b")).toEqual({ incoming: 1, outgoing: 0 });
  });
});

describe("uniqueName", () => {
  it("returns the base, then numbered names, within 255 characters", () => {
    expect(uniqueName("Copy of A", ["A"])).toBe("Copy of A");
    expect(uniqueName("Copy of A", ["copy of a", "Copy of A (2)"])).toBe("Copy of A (3)");
    const long = uniqueName("x".repeat(300), ["x".repeat(255)]);
    expect(long).toHaveLength(255);
    expect(long.endsWith(" (2)")).toBe(true);
    const spaced = uniqueName(`${"x".repeat(250)} yyyyyy`, [`${"x".repeat(250)} yyyyyy`.slice(0, 255)]);
    expect(spaced).not.toContain("  ");
  });
});

describe("errorTarget", () => {
  const draft: TDraftGraph = {
    states: [
      state("a", { status: status("Same") }),
      state("b", { status: status("same") }),
      state("c", { status: status(" ") }),
    ],
    transitions: [
      { key: "ok", name: "", from_any: false, source_keys: ["a"], target_key: "b", rules: [] },
      { key: "bad", name: "", from_any: false, source_keys: [], target_key: "b", rules: [] },
      {
        key: "rule",
        name: "",
        from_any: true,
        source_keys: [],
        target_key: "a",
        rules: [{ type: "restrict_actors", params: {} }],
      },
    ],
  };

  it("points at the element behind a validation code", () => {
    expect(errorTarget(draft, "duplicate_status_name")).toEqual({ kind: "state", key: "b" });
    expect(errorTarget(draft, "status_name_required")).toEqual({ kind: "state", key: "c" });
    expect(errorTarget(draft, "invalid_transition")).toEqual({ kind: "transition", key: "bad" });
    expect(errorTarget(draft, "invalid_rule")).toEqual({ kind: "transition", key: "rule" });
    expect(errorTarget(draft, "initial_state_required")).toBeNull();
  });

  it("points at the second state holding the same status", () => {
    const twice: TDraftGraph = {
      states: [state("a", { status: status("A", { id: "s" }) }), state("b", { status: status("B", { id: "s" }) })],
      transitions: [],
    };
    expect(errorTarget(twice, "duplicate_status")).toEqual({ kind: "state", key: "b" });
    expect(errorTarget(draft, "duplicate_status")).toBeNull();
  });
});
