/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import type { IState, TProjectWorkflowScheme, TWorkflowGraph, TWorkflowRule } from "@plane/types";
import {
  getAllowedTargetStateIds,
  getArrivalStateIds,
  getEffectiveTypeId,
  getInitialStateId,
  getWorkflowRefusalKey,
  getWorkflowStateIds,
  isProjectWorkflowManaged,
  type TWorkflowIssue,
} from "./helpers";

const status = (id: string) => ({ id, name: id, color: "#3A3A3A", group: "started" as const, group_is_auto: true });
const node = (id: string, isInitial = false) => ({
  id: `n-${id}`,
  status: status(id),
  position_x: 0,
  position_y: 0,
  is_initial: isInitial,
});
const arrow = (sources: string[] | "*", target: string, rules: TWorkflowRule[] = []) => ({
  id: `t-${target}-${sources}`,
  name: "",
  from_any: sources === "*",
  source_ids: sources === "*" ? [] : sources.map((source) => `n-${source}`),
  target_id: `n-${target}`,
  rules,
});
const projectState = (statusId: string | null, id = `s-${statusId}`): IState => ({
  id,
  color: "#3A3A3A",
  default: false,
  description: "",
  group: "started",
  name: statusId ?? id,
  project_id: "p",
  sequence: 0,
  workspace_id: "w",
  order: 0,
  workflow_status: statusId,
});

const software: TWorkflowGraph = {
  id: "software",
  name: "Software",
  description: "",
  updated_at: null,
  states: [node("todo", true), node("doing"), node("done"), node("cancelled")],
  transitions: [
    arrow(["todo"], "doing"),
    arrow(["doing"], "done", [{ type: "restrict_actors", params: { roles: [20], creator: true } }]),
    arrow("*", "cancelled"),
  ],
};
const support: TWorkflowGraph = {
  id: "support",
  name: "Support",
  description: "",
  updated_at: null,
  states: [node("new", true), node("doing")],
  transitions: [arrow(["new"], "doing")],
};
const scheme: TProjectWorkflowScheme = {
  default_workflow_id: "software",
  items: [{ issue_type_id: "bug", workflow_id: "support" }],
  workflows: [software, support],
};
const states = ["todo", "doing", "done", "cancelled", "new"].map((id) => projectState(id));
const issue = (stateStatus: string, overrides: Partial<TWorkflowIssue> = {}): TWorkflowIssue => ({
  state_id: `s-${stateStatus}`,
  type_id: "task",
  assignee_ids: [],
  created_by: "someone",
  ...overrides,
});
const member = { userId: "me", projectRole: 15 };

describe("getAllowedTargetStateIds", () => {
  it("returns null for a free project", () => {
    expect(
      getAllowedTargetStateIds({
        scheme: { default_workflow_id: null, items: [], workflows: [] },
        projectStates: states,
        issue: issue("todo"),
        actor: member,
      })
    ).toBeNull();
  });

  it("keeps the current state and adds arrow targets and global targets", () => {
    const allowed = getAllowedTargetStateIds({ scheme, projectStates: states, issue: issue("todo"), actor: member });
    expect(new Set(allowed)).toEqual(new Set(["s-cancelled", "s-doing", "s-todo"]));
  });

  it("applies restrict actors with OR between criteria", () => {
    const asMember = getAllowedTargetStateIds({ scheme, projectStates: states, issue: issue("doing"), actor: member });
    const asCreator = getAllowedTargetStateIds({
      scheme,
      projectStates: states,
      issue: issue("doing", { created_by: "me" }),
      actor: member,
    });
    const asAdmin = getAllowedTargetStateIds({
      scheme,
      projectStates: states,
      issue: issue("doing"),
      actor: { userId: "me", projectRole: 20 },
    });
    expect(asMember?.has("s-done")).toBe(false);
    expect(asCreator?.has("s-done")).toBe(true);
    expect(asAdmin?.has("s-done")).toBe(true);
  });

  it("uses the workflow of the item type", () => {
    const allowed = getAllowedTargetStateIds({
      scheme,
      projectStates: states,
      issue: issue("new", { type_id: "bug" }),
      actor: member,
    });
    expect(new Set(allowed)).toEqual(new Set(["s-doing", "s-new"]));
  });

  it("offers only global transitions from an unmanaged state", () => {
    const stray = projectState(null, "s-stray");
    const allowed = getAllowedTargetStateIds({
      scheme,
      projectStates: [...states, stray],
      issue: issue("x", { state_id: "s-stray" }),
      actor: member,
    });
    expect(new Set(allowed)).toEqual(new Set(["s-cancelled", "s-stray"]));
  });

  it("refuses rules without a known actor", () => {
    const allowed = getAllowedTargetStateIds({
      scheme,
      projectStates: states,
      issue: issue("doing", { created_by: "me" }),
      actor: { userId: undefined, projectRole: undefined },
    });
    expect(allowed?.has("s-done")).toBe(false);
  });

  it("admits listed users and assignees", () => {
    const rules = (params: object): TWorkflowGraph => ({
      ...software,
      transitions: [arrow(["doing"], "done", [{ type: "restrict_actors", params }])],
    });
    const run = (params: object, overrides: Partial<TWorkflowIssue>) =>
      getAllowedTargetStateIds({
        scheme: { ...scheme, workflows: [rules(params), support] },
        projectStates: states,
        issue: issue("doing", overrides),
        actor: member,
      })?.has("s-done");
    expect(run({ user_ids: ["me"] }, {})).toBe(true);
    expect(run({ user_ids: ["other"] }, {})).toBe(false);
    expect(run({ assignee: true }, { assignee_ids: ["me"] })).toBe(true);
    expect(run({ assignee: true }, {})).toBe(false);
  });

  it("refuses an unknown rule type", () => {
    const unknown = { type: "other", params: {} } as unknown as TWorkflowRule;
    const graph: TWorkflowGraph = { ...software, transitions: [arrow(["doing"], "done", [unknown])] };
    const allowed = getAllowedTargetStateIds({
      scheme: { ...scheme, workflows: [graph, support] },
      projectStates: states,
      issue: issue("doing"),
      actor: { userId: "me", projectRole: 20 },
    });
    expect(allowed?.has("s-done")).toBe(false);
  });

  it("requires every rule of an arrow to pass", () => {
    const both = [
      { type: "restrict_actors", params: { roles: [20] } },
      { type: "restrict_actors", params: { user_ids: ["someone-else"] } },
    ] as TWorkflowRule[];
    const graph: TWorkflowGraph = { ...software, transitions: [arrow(["doing"], "done", both)] };
    const allowed = getAllowedTargetStateIds({
      scheme: { ...scheme, workflows: [graph, support] },
      projectStates: states,
      issue: issue("doing"),
      actor: { userId: "me", projectRole: 20 },
    });
    expect(allowed?.has("s-done")).toBe(false);
  });

  it("does not offer a source-bound arrow from an unmanaged state", () => {
    const stray = projectState(null, "s-stray");
    const allowed = getAllowedTargetStateIds({
      scheme,
      projectStates: [...states, stray],
      issue: issue("x", { state_id: "s-stray" }),
      actor: { userId: "me", projectRole: 20 },
    });
    expect(allowed?.has("s-doing")).toBe(false);
    expect(allowed?.has("s-done")).toBe(false);
  });
});

describe("initial and workflow states", () => {
  it("returns the initial state of the type workflow", () => {
    expect(getInitialStateId(scheme, states, "task")).toBe("s-todo");
    expect(getInitialStateId(scheme, states, "bug")).toBe("s-new");
    expect(getInitialStateId({ default_workflow_id: null, items: [], workflows: [] }, states, "task")).toBeUndefined();
  });

  it("lists the states of the type workflow", () => {
    expect(new Set(getWorkflowStateIds(scheme, states, "bug"))).toEqual(new Set(["s-doing", "s-new"]));
  });
});

describe("getEffectiveTypeId", () => {
  it("falls back to the project default type, as the server does", () => {
    expect(getEffectiveTypeId("bug", "task")).toBe("bug");
    expect(getEffectiveTypeId(null, "task")).toBe("task");
    expect(getEffectiveTypeId(undefined, undefined)).toBeNull();
  });
});

describe("getArrivalStateIds", () => {
  it("asks for an arrival state only when the current state is outside the new workflow", () => {
    expect(new Set(getArrivalStateIds(scheme, states, "bug", "s-todo"))).toEqual(new Set(["s-doing", "s-new"]));
    expect(getArrivalStateIds(scheme, states, "bug", "s-doing")).toBeNull();
    expect(getArrivalStateIds(scheme, states, "bug", null)).not.toBeNull();
  });

  it("never asks in a free project", () => {
    expect(
      getArrivalStateIds({ default_workflow_id: null, items: [], workflows: [] }, states, "bug", "s-todo")
    ).toBeNull();
  });
});

describe("getWorkflowRefusalKey", () => {
  it("maps the two server codes and ignores anything else", () => {
    expect(getWorkflowRefusalKey({ workflow: ["transition_not_allowed"] })).toBe("workflows.workflow_disabled.title");
    expect(getWorkflowRefusalKey({ workflow: ["arrival_state_required"] })).toBe(
      "workflows.refusal.arrival_state_required"
    );
    expect(getWorkflowRefusalKey({ workflow: ["<script>"] })).toBeUndefined();
    expect(getWorkflowRefusalKey({ detail: "x" })).toBeUndefined();
    expect(getWorkflowRefusalKey(undefined)).toBeUndefined();
    expect(getWorkflowRefusalKey(new Error("Network Error"))).toBeUndefined();
  });
});

describe("isProjectWorkflowManaged", () => {
  it("is true only when the project has a scheme", () => {
    expect(isProjectWorkflowManaged(scheme)).toBe(true);
    expect(isProjectWorkflowManaged({ default_workflow_id: null, items: [], workflows: [] })).toBe(false);
    expect(isProjectWorkflowManaged(undefined)).toBe(false);
  });
});
