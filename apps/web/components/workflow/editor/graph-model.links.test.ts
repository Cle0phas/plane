/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import type { TWorkflowDetail, TWorkflowStatus } from "@plane/types";
import {
  addStates,
  addTransitionWithStates,
  clearInitial,
  connectStates,
  errorTarget,
  fromDetail,
  getGraphErrorKey,
  isDuplicateRoute,
  optionToStatus,
  READABLE_ZOOM,
  refitTarget,
  removeState,
  renamedSharedStatuses,
  sourceCandidates,
  startPlacement,
  statusOptions,
  validateDraft,
  type TDraftGraph,
  type TDraftStatus,
} from "./graph-model";

const status = (name: string, extra: Partial<TDraftStatus> = {}): TDraftStatus => ({
  name,
  color: "#3A3A3A",
  group: null,
  shared_count: 0,
  ...extra,
});
const state = (key: string, name: string, x = 0, isInitial = false, extra: Partial<TDraftStatus> = {}) => ({
  key,
  status: status(name, extra),
  position_x: x,
  position_y: 0,
  is_initial: isInitial,
});
const arrow = (key: string, sources: string[] | "*", target: string) => ({
  key,
  name: "",
  from_any: sources === "*",
  source_keys: sources === "*" ? [] : sources,
  target_key: target,
  rules: [],
  sides: {},
});
const base: TDraftGraph = {
  states: [state("a", "Todo", 0, true), state("b", "Doing", 240), state("c", "Done", 480)],
  transitions: [arrow("t1", ["a"], "b")],
};

describe("start link", () => {
  it("can be removed, which is an error pointing at the start", () => {
    const unlinked = clearInitial(base);
    expect(unlinked.states.some((item) => item.is_initial)).toBe(false);
    expect(validateDraft(unlinked)).toContain("initial_state_required");
    expect(errorTarget(unlinked, "initial_state_required")).toEqual({ kind: "start" });
  });

  it("is not moved to another state when the start state is removed", () => {
    expect(removeState(base, "a").states.some((item) => item.is_initial)).toBe(false);
  });

  it("is set on the first state of an empty workflow only", () => {
    const empty: TDraftGraph = { states: [], transitions: [] };
    expect(addStates(empty, [{ key: "n", status: status("New") }]).states[0].is_initial).toBe(true);
    const added = addStates(clearInitial(base), [{ key: "n", status: status("New") }]);
    expect(added.states.some((item) => item.is_initial)).toBe(false);
  });

  it("keeps the start node left of the diagram when nothing is linked", () => {
    expect(startPlacement(clearInitial(base))).toEqual({ x: -160, y: -20, sides: { source: "right", target: "left" } });
    expect(startPlacement({ states: [], transitions: [] })).toBeNull();
  });
});

describe("duplicate transitions", () => {
  it("detects a route that another transition already has", () => {
    const route = (sources: string[] | "*", target: string) => arrow("x", sources, target);
    expect(isDuplicateRoute(base, route(["a"], "b"))).toBe(true);
    expect(isDuplicateRoute(base, route(["c", "a"], "b"))).toBe(true);
    expect(isDuplicateRoute(base, route(["c"], "b"))).toBe(false);
    expect(isDuplicateRoute(base, route(["a"], "b"), "t1")).toBe(false);
    // A global transition and a transition from a state are two routes: their rules may differ.
    expect(isDuplicateRoute(base, route("*", "b"))).toBe(false);
    const withGlobal = { ...base, transitions: [...base.transitions, arrow("g", "*", "c")] };
    expect(isDuplicateRoute(withGlobal, route("*", "c"))).toBe(true);
  });

  it("is a draft error pointing at the later transition", () => {
    const draft = { ...base, transitions: [...base.transitions, arrow("t2", ["a", "c"], "b")] };
    expect(validateDraft(draft)).toContain("duplicate_transition");
    expect(errorTarget(draft, "duplicate_transition")).toEqual({ kind: "transition", key: "t2" });
    expect(validateDraft(base)).not.toContain("duplicate_transition");
  });

  it("is not created by drawing the same arrow twice", () => {
    expect(connectStates(base, "t2", "a", "right", "b", "left")).toBe(base);
  });

  it("is not offered as one more source of a transition", () => {
    expect(sourceCandidates(base, "t1").map((item) => item.key)).toEqual(["c"]);
    const draft = { ...base, transitions: [...base.transitions, arrow("t2", ["c"], "b")] };
    expect(sourceCandidates(draft, "t1")).toEqual([]);
    expect(sourceCandidates({ ...base, transitions: [arrow("g", "*", "b")] }, "g")).toEqual([]);
  });

  it("maps the two new server codes to their messages", () => {
    expect(getGraphErrorKey({ graph: ["stale_graph"] }).key).toBe("workflows.editor.errors.stale_graph");
    expect(getGraphErrorKey({ graph: ["duplicate_transition"] }).key).toBe(
      "workflows.editor.errors.duplicate_transition"
    );
  });
});

describe("addTransitionWithStates", () => {
  it("adds the states picked outside the workflow, right of the last one, then the transition", () => {
    const next = addTransitionWithStates(base, {
      key: "t9",
      name: " Review ",
      from_any: false,
      sources: [
        { kind: "state", key: "a" },
        { kind: "new", key: "n1", status: status("Review") },
      ],
      target: { kind: "new", key: "n2", status: status("Shipped") },
    });
    expect(next.states.map((item) => [item.key, item.position_x, item.is_initial])).toEqual([
      ["a", 0, true],
      ["b", 240, false],
      ["c", 480, false],
      ["n1", 720, false],
      ["n2", 960, false],
    ]);
    expect(next.transitions[1]).toEqual({
      key: "t9",
      name: "Review",
      from_any: false,
      source_keys: ["a", "n1"],
      target_key: "n2",
      rules: [],
      sides: {},
    });
  });

  it("ignores the sources of a transition from any state", () => {
    const next = addTransitionWithStates(base, {
      key: "t9",
      name: "",
      from_any: true,
      sources: [{ kind: "new", key: "n1", status: status("Review") }],
      target: { kind: "state", key: "c" },
    });
    expect(next.states).toHaveLength(3);
    expect(next.transitions[1]).toMatchObject({ from_any: true, source_keys: [], target_key: "c" });
  });

  it("links the start to the first state added to an empty workflow", () => {
    const next = addTransitionWithStates(
      { states: [], transitions: [] },
      {
        key: "t9",
        name: "",
        from_any: false,
        sources: [{ kind: "new", key: "n1", status: status("Todo") }],
        target: { kind: "new", key: "n2", status: status("Done") },
      }
    );
    expect(next.states.map((item) => item.is_initial)).toEqual([true, false]);
  });
});

const serverStatus = (id: string, name: string, workflows: { id: string; name: string }[]): TWorkflowStatus => ({
  id,
  name,
  color: "#3A3A3A",
  group: "started",
  group_is_auto: true,
  workflow_count: workflows.length,
  workflows,
});

describe("shared statuses", () => {
  const shared = serverStatus("s1", "Todo", [
    { id: "w", name: "Software" },
    { id: "w2", name: "Bug" },
    { id: "w3", name: "Delivery" },
  ]);
  const detail: TWorkflowDetail = {
    id: "w",
    name: "Software",
    description: "",
    updated_at: null,
    version: "v1",
    project_count: 0,
    states: [{ id: "a", status: shared, position_x: 0, position_y: 0, is_initial: true }],
    transitions: [],
  } as TWorkflowDetail;

  it("names the other workflows of a status and remembers its server name", () => {
    const draftStatus = fromDetail(detail, [shared]).states[0].status;
    expect(draftStatus.shared_names).toEqual(["Bug", "Delivery"]);
    expect(draftStatus.server_name).toBe("Todo");
  });

  it("carries the names through the list of other existing states", () => {
    const [option] = statusOptions([shared], [{ name: "Review", color: "#333333", group: "started" }], {
      states: [],
      transitions: [],
    });
    expect(option.workflow_names).toEqual(["Software", "Bug", "Delivery"]);
    expect(optionToStatus(option)).toMatchObject({
      server_name: "Todo",
      shared_names: ["Software", "Bug", "Delivery"],
    });
    const [, candidate] = statusOptions([shared], [{ name: "Review", color: "#333333", group: "started" }], {
      states: [],
      transitions: [],
    });
    expect(optionToStatus(candidate).server_name).toBeUndefined();
    expect(optionToStatus(candidate).shared_names).toEqual([]);
  });

  it("leaves the edited workflow out of the names of a status", () => {
    const [option] = statusOptions([shared], [], { states: [], transitions: [] }, "w");
    expect(option.workflow_names).toEqual(["Bug", "Delivery"]);
  });

  it("lists the renamed statuses that other workflows use", () => {
    const draft: TDraftGraph = {
      states: [
        state("a", "To do", 0, true, { id: "s1", server_name: "Todo", shared_names: ["Bug"] }),
        state("b", "Doing", 240, false, { id: "s2", server_name: "Doing", shared_names: ["Bug"] }),
        state("c", "Finished", 480, false, { id: "s3", server_name: "Done", shared_names: [] }),
        state("d", "Brand new", 720),
      ],
      transitions: [],
    };
    expect(renamedSharedStatuses(draft)).toEqual([{ key: "a", from: "Todo", to: "To do", workflows: ["Bug"] }]);
  });
});

describe("refitTarget", () => {
  it("shows the whole diagram when it fits at a readable size", () => {
    expect(refitTarget(READABLE_ZOOM, true, false)).toBe("all");
    expect(refitTarget(READABLE_ZOOM, false, true)).toBe("all");
  });

  it("opens on the start when the diagram is too large", () => {
    expect(refitTarget(0.4, true, false)).toBe("start");
  });

  it("then follows the state just added, and stays put after a removal", () => {
    expect(refitTarget(0.4, false, true)).toBe("last");
    expect(refitTarget(0.4, false, false)).toBe("keep");
  });
});
