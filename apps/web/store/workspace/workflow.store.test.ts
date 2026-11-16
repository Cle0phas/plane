/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import type { TProjectWorkflowScheme, TWorkflowDetail, TWorkflowSummary } from "@plane/types";
import type { WorkflowService } from "@/services/workflow.service";
import { WorkflowStore } from "./workflow.store";

const summary = (id: string, name: string): TWorkflowSummary => ({
  id,
  name,
  description: "",
  created_at: "2026-11-12T00:00:00Z",
  updated_at: "2026-11-12T00:00:00Z",
  state_count: 0,
  project_count: 0,
});
const detail = (id: string, name: string): TWorkflowDetail => ({
  id,
  name,
  description: "",
  updated_at: null,
  version: "v1",
  states: [],
  transitions: [],
  project_count: 1,
  projects: [{ id: "p", name: "Secret" }],
});

const buildStore = (overrides: object = {}) =>
  new WorkflowStore({
    list: async () => [summary("b", "Beta"), summary("a", "Alpha")],
    listStatuses: async () => [],
    listCandidates: async () => [],
    saveGraph: async (_slug: string, id: string) => detail(id, "Saved"),
    getProjectScheme: async (): Promise<TProjectWorkflowScheme> => ({
      default_workflow_id: "a",
      items: [],
      workflows: [{ id: "a", name: "Alpha", description: "", updated_at: null, states: [], transitions: [] }],
    }),
    ...overrides,
  } as unknown as WorkflowService);

describe("WorkflowStore", () => {
  it("keeps workflows per workspace, sorted by name", async () => {
    const store = buildStore();
    await store.fetchWorkflows("acme");
    expect(store.getWorkspaceWorkflows("acme").map((workflow) => workflow.name)).toEqual(["Alpha", "Beta"]);
    expect(store.getWorkspaceWorkflows("other")).toEqual([]);
  });

  it("refreshes cached project schemes after a graph save", async () => {
    const store = buildStore();
    await store.fetchProjectScheme("acme", "project");
    await store.saveGraph("acme", "a", { states: [], transitions: [], expected_version: "v1" });
    const cached = store.getProjectScheme("project");
    expect(cached?.workflows[0].name).toBe("Saved");
    expect(cached?.workflows[0]).not.toHaveProperty("projects");
    expect(store.getWorkflowDetail("a")?.name).toBe("Saved");
  });

  it("propagates service errors", async () => {
    const store = buildStore({
      saveGraph: async () => {
        throw { graph: ["status_in_use"] };
      },
    });
    await expect(store.saveGraph("acme", "a", { states: [], transitions: [], expected_version: "v1" })).rejects.toEqual(
      {
        graph: ["status_in_use"],
      }
    );
  });

  it("keeps status candidates per workspace", async () => {
    const store = buildStore({
      listCandidates: async () => [{ name: "Review", color: "#3A3A3A", group: "started" }],
    });
    await store.fetchCandidates("acme");
    expect(store.getWorkspaceCandidates("acme").map((candidate) => candidate.name)).toEqual(["Review"]);
    expect(store.getWorkspaceCandidates("other")).toEqual([]);
  });

  it("stores a duplicated workflow and refreshes the list", async () => {
    const calls: string[] = [];
    const store = buildStore({
      duplicate: async (_slug: string, id: string, name: string) => {
        calls.push(`${id}:${name}`);
        return detail("copy", name);
      },
    });
    const copy = await store.duplicateWorkflow("acme", "a", "Copy of Alpha");
    expect(calls).toEqual(["a:Copy of Alpha"]);
    expect(copy.id).toBe("copy");
    expect(store.getWorkflowDetail("copy")?.name).toBe("Copy of Alpha");
    expect(store.getWorkspaceWorkflows("acme")).toHaveLength(2);
  });

  it("refreshes the candidates after a graph save", async () => {
    let reads = 0;
    const store = buildStore({
      listCandidates: async () => {
        reads += 1;
        return [];
      },
    });
    await store.saveGraph("acme", "a", { states: [], transitions: [], expected_version: "v1" });
    expect(reads).toBe(1);
  });

  it("sends the expected version with a graph save", async () => {
    const calls: unknown[] = [];
    const store = buildStore({
      saveGraph: async (_slug: string, id: string, payload: unknown) => {
        calls.push(payload);
        return detail(id, "Saved");
      },
    });
    await store.saveGraph("acme", "a", { states: [], transitions: [], expected_version: "v1" });
    expect(calls).toEqual([{ states: [], transitions: [], expected_version: "v1" }]);
  });

  it("returns the other editors of a workflow", async () => {
    const calls: unknown[][] = [];
    const store = buildStore({
      sendPresence: async (...args: unknown[]) => {
        calls.push(args);
        return { editors: [{ id: "u", display_name: "Awa" }] };
      },
    });
    expect(await store.sendPresence("acme", "a", true)).toEqual([{ id: "u", display_name: "Awa" }]);
    expect(calls).toEqual([["acme", "a", true]]);
  });
});
