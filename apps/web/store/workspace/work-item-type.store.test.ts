/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import type { TIssueType, TProjectIssueType } from "@plane/types";
import type { WorkItemTypeService } from "@/services/work-item-type.service";
import { WorkItemTypeStore } from "./work-item-type.store";

const buildType = (overrides: Partial<TIssueType>): TIssueType => ({
  id: "type",
  name: "Type",
  description: "",
  logo_props: { in_use: "icon", icon: { name: "check_box", color: "#6d7b8a" } },
  is_active: true,
  is_default: false,
  issue_count: 0,
  project_default_count: 0,
  created_at: "2026-11-12T00:00:00Z",
  updated_at: "2026-11-12T00:00:00Z",
  ...overrides,
});

const buildStore = (types: TIssueType[], links: TProjectIssueType[], overrides: object = {}) => {
  const state = { types };
  const service = {
    list: async () => state.types,
    listProjectTypes: async () => links,
    update: async (_slug: string, typeId: string) => {
      state.types = state.types.map((type) => ({ ...type, is_default: type.id === typeId }));
      return state.types.find((type) => type.id === typeId) as TIssueType;
    },
    ...overrides,
  } as unknown as WorkItemTypeService;
  return new WorkItemTypeStore(service);
};

const TYPES = [
  buildType({ id: "task", name: "Task", is_default: true }),
  buildType({ id: "bug", name: "Bug" }),
  buildType({ id: "epic", name: "Archived epic", is_active: false }),
  buildType({ id: "story", name: "Story" }),
];

const LINKS: TProjectIssueType[] = [
  { id: "l1", project_id: "p1", issue_type_id: "task", is_default: false, issue_count: 0 },
  { id: "l2", project_id: "p1", issue_type_id: "bug", is_default: true, issue_count: 2 },
  { id: "l3", project_id: "p1", issue_type_id: "epic", is_default: false, issue_count: 1 },
];

const loadedStore = async () => {
  const store = buildStore(TYPES, LINKS);
  await store.fetchWorkspaceTypes("acme");
  await store.fetchProjectTypes("acme", "p1");
  return store;
};

describe("WorkItemTypeStore", () => {
  it("lists every workspace type, inactive ones included, default first then by name", async () => {
    const store = await loadedStore();
    expect(store.getWorkspaceTypes("acme").map((type) => type.id)).toEqual(["task", "epic", "bug", "story"]);
  });

  it("offers only the active types enabled in the project, project default first", async () => {
    const store = await loadedStore();
    expect(store.getProjectAssignableTypes("acme", "p1").map((type) => type.id)).toEqual(["bug", "task"]);
  });

  it("returns the project default type", async () => {
    const store = await loadedStore();
    expect(store.getProjectDefaultTypeId("p1")).toBe("bug");
  });

  it("has no default for a project that is not loaded", async () => {
    const store = await loadedStore();
    expect(store.getProjectDefaultTypeId("p2")).toBeNull();
    expect(store.getProjectAssignableTypes("acme", "p2")).toEqual([]);
  });

  it("finds a type and its project link by id", async () => {
    const store = await loadedStore();
    expect(store.getTypeById("acme", "epic")?.is_active).toBe(false);
    expect(store.getTypeById("acme", null)).toBeUndefined();
    expect(store.getProjectTypeLink("p1", "epic")?.issue_count).toBe(1);
    expect(store.getProjectTypeLink("p1", "story")).toBeUndefined();
  });

  it("reloads the list when another type becomes the default", async () => {
    const store = await loadedStore();
    await store.updateType("acme", "story", { is_default: true });
    expect(store.getTypeById("acme", "task")?.is_default).toBe(false);
    expect(store.getTypeById("acme", "story")?.is_default).toBe(true);
  });

  it("never returns the types of another workspace", async () => {
    const store = await loadedStore();
    expect(store.getWorkspaceTypes("other")).toEqual([]);
    expect(store.getTypeById("other", "task")).toBeUndefined();
    expect(store.getProjectAssignableTypes("other", "p1")).toEqual([]);
  });

  it("keeps the current workspace types when a late response for a previous one arrives", async () => {
    let resolveA: ((types: TIssueType[]) => void) | undefined;
    const store = buildStore([], [], {
      list: (slug: string) =>
        slug === "a"
          ? new Promise<TIssueType[]>((resolve) => (resolveA = resolve))
          : Promise.resolve([buildType({ id: "b-type", name: "B" })]),
    });
    const lateA = store.fetchWorkspaceTypes("a");
    await store.fetchWorkspaceTypes("b");
    resolveA?.([buildType({ id: "a-type", name: "A" })]);
    await lateA;
    expect(store.getWorkspaceTypes("b").map((type) => type.id)).toEqual(["b-type"]);
    expect(store.getWorkspaceTypes("a").map((type) => type.id)).toEqual(["a-type"]);
  });

  it("leaves the state unchanged when the service rejects", async () => {
    const store = buildStore(TYPES, LINKS, {
      update: async () => Promise.reject({ error: "refused" }),
      remove: async () => Promise.reject({ error: "refused" }),
    });
    await store.fetchWorkspaceTypes("acme");
    await expect(store.updateType("acme", "bug", { is_active: false })).rejects.toEqual({ error: "refused" });
    await expect(store.removeType("acme", "bug")).rejects.toEqual({ error: "refused" });
    expect(store.getTypeById("acme", "bug")?.is_active).toBe(true);
  });

  it("resolves when the default is saved even if the reload fails", async () => {
    const store = buildStore(TYPES, LINKS, {
      list: async () => Promise.reject(new Error("network")),
    });
    await expect(store.updateType("acme", "story", { is_default: true })).resolves.toBeDefined();
  });
});
