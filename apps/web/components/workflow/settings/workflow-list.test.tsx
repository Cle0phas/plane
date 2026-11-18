/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TWorkflowSummary } from "@plane/types";
import { WorkspaceWorkflowList } from "./workflow-list";

// Real t is a new function on every render; copy_name keeps its parameter so names can be asserted.
vi.mock("@plane/i18n", () => ({
  useTranslation: () => ({
    t: (key: string, params?: { name?: string }) =>
      key === "workflows.settings.duplicate.copy_name" ? `Copy of ${params?.name}` : key,
  }),
}));
const setToast = vi.hoisted(() => vi.fn());
vi.mock("@plane/blocks/toast", () => ({ setToast }));

// Base UI menus wait for their exit animations on close; jsdom has no Web Animations API.
// oxlint-disable-next-line no-extend-native -- test-only polyfill of a missing browser API
Element.prototype.getAnimations ??= () => [];

const state = vi.hoisted(() => ({
  isAdmin: true,
  workflows: [] as TWorkflowSummary[],
  removeWorkflow: vi.fn(),
  duplicateWorkflow: vi.fn(),
}));
vi.mock("@/hooks/store/use-workflow", () => ({
  useWorkflow: () => ({
    getWorkspaceWorkflows: () => state.workflows,
    removeWorkflow: state.removeWorkflow,
    duplicateWorkflow: state.duplicateWorkflow,
  }),
}));
vi.mock("@/hooks/store/user", () => ({ useUserPermissions: () => ({ allowPermissions: () => state.isAdmin }) }));

const summary = (id: string, name: string, extra: Partial<TWorkflowSummary> = {}): TWorkflowSummary => ({
  id,
  name,
  description: "",
  created_at: "2026-11-01T10:00:00Z",
  updated_at: "2026-11-02T10:00:00Z",
  state_count: 3,
  states: [],
  transition_count: 0,
  project_count: 0,
  ...extra,
});
beforeEach(() => {
  state.isAdmin = true;
  state.workflows = [summary("a", "Software")];
  state.removeWorkflow = vi.fn().mockResolvedValue(undefined);
  state.duplicateWorkflow = vi.fn().mockResolvedValue({});
  setToast.mockClear();
});

const open = () => {
  render(
    <MemoryRouter>
      <WorkspaceWorkflowList workspaceSlug="ws" />
    </MemoryRouter>
  );
  return userEvent.setup();
};

const states = (...names: string[]) => names.map((name) => ({ name, group: "started" as const }));
const MORE = "workflows.settings.more_actions";
const DUPLICATE = "workflows.settings.duplicate.action";
const DELETE = "workflows.settings.delete.action";
const SEARCH = "workflows.settings.search";

const openMenu = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getAllByRole("button", { name: MORE })[0]);
};

describe("rows", () => {
  it("previews the first five states in flow order, then the rest as a count", () => {
    state.workflows = [
      summary("a", "Software", {
        states: states("A", "B", "C", "D", "E", "F", "G"),
        state_count: 7,
        transition_count: 6,
      }),
    ];
    open();
    for (const name of ["A", "B", "C", "D", "E"]) expect(screen.getByText(name)).toBeTruthy();
    expect(screen.queryByText("F")).toBeNull();
    expect(screen.getByText("+2").getAttribute("title")).toBe("F, G");
  });

  it("flags an empty workflow and invites an admin to add a first state", () => {
    state.workflows = [summary("a", "Draft", { state_count: 0 })];
    open();
    expect(screen.getByText("workflows.settings.empty_badge")).toBeTruthy();
    expect(screen.getByRole("link", { name: "workflows.settings.add_first_state" })).toBeTruthy();
  });

  it("keeps the description out of the table, behind a focusable icon", () => {
    state.workflows = [summary("a", "Support", { description: "Help desk" })];
    open();
    expect(screen.queryByRole("columnheader", { name: "workflows.settings.columns.description" })).toBeNull();
    const info = screen.getByRole("button", { name: "workflows.settings.description_label" });
    const ids = (info.getAttribute("aria-describedby") ?? "").split(" ");
    expect(ids.map((id) => document.getElementById(id)?.textContent)).toContain("Help desk");
  });

  it("says when a workflow is not used", () => {
    open();
    expect(screen.getByText("workflows.settings.not_used")).toBeTruthy();
  });
});

describe("toolbar", () => {
  beforeEach(() => {
    state.workflows = [summary("a", "Software", { project_count: 1 }), summary("b", "Support")];
  });

  it("searches by name, ignoring case", async () => {
    const user = open();
    await user.type(screen.getByRole("searchbox", { name: SEARCH }), "SUPP");
    expect(screen.queryByRole("link", { name: "Software" })).toBeNull();
    expect(screen.getByRole("link", { name: "Support" })).toBeTruthy();
  });

  it("says so when nothing matches", async () => {
    const user = open();
    await user.type(screen.getByRole("searchbox", { name: SEARCH }), "zzz");
    expect(screen.getByText("workflows.settings.no_match")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("filters on usage", async () => {
    const user = open();
    await user.click(screen.getByRole("button", { name: "workflows.settings.usage.label" }));
    await user.click(await screen.findByRole("menuitemradio", { name: "workflows.settings.usage.unused" }));
    expect(screen.queryByRole("link", { name: "Software" })).toBeNull();
    expect(screen.getByRole("link", { name: "Support" })).toBeTruthy();
  });
});

describe("actions menu", () => {
  it("duplicates with a free copy name and confirms with a toast", async () => {
    state.workflows = [summary("a", "Software"), summary("b", "Copy of Software")];
    const user = open();
    await openMenu(user);
    await user.click(await screen.findByRole("menuitem", { name: DUPLICATE }));
    await waitFor(() => expect(state.duplicateWorkflow).toHaveBeenCalledWith("ws", "a", "Copy of Software (2)"));
    expect(setToast).toHaveBeenCalledWith(expect.objectContaining({ type: "success" }));
  });

  it("shows the error toast when the server refuses", async () => {
    state.duplicateWorkflow = vi.fn().mockRejectedValue(new Error("no"));
    const user = open();
    await openMenu(user);
    await user.click(await screen.findByRole("menuitem", { name: DUPLICATE }));
    await waitFor(() => expect(setToast).toHaveBeenCalledWith(expect.objectContaining({ type: "error" })));
  });

  it("disables deletion of a used workflow and says why", async () => {
    state.workflows = [summary("a", "Software", { project_count: 2 })];
    const user = open();
    await openMenu(user);
    const item = await screen.findByRole("menuitem", { name: new RegExp(DELETE) });
    expect(item.getAttribute("aria-disabled")).toBe("true");
    expect(item.textContent).toContain("workflows.settings.delete.used_by");
    expect(screen.queryByText("workflows.settings.delete.in_use")).toBeNull();
  });

  it("asks for confirmation before removing an unused workflow", async () => {
    const user = open();
    await openMenu(user);
    await user.click(await screen.findByRole("menuitem", { name: DELETE }));
    expect(state.removeWorkflow).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: DELETE }));
    await waitFor(() => expect(state.removeWorkflow).toHaveBeenCalledWith("ws", "a"));
  });

  it("is hidden from a non-admin, with the invitation to add a state", () => {
    state.isAdmin = false;
    state.workflows = [summary("a", "Draft", { state_count: 0 })];
    open();
    expect(screen.queryByRole("button", { name: MORE })).toBeNull();
    expect(screen.queryByRole("link", { name: "workflows.settings.add_first_state" })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "workflows.settings.columns.actions" })).toBeNull();
  });
});

describe("used in", () => {
  it("exposes the project names to assistive technology from a focusable count", async () => {
    state.workflows = [
      summary("a", "Software", {
        project_count: 2,
        projects: [
          { id: "p1", name: "Alpha" },
          { id: "p2", name: "Beta" },
        ],
      }),
    ];
    const user = open();
    const trigger = screen.getByRole("button", { name: "workflows.settings.project_count" });
    // Tab through the row until the count takes focus: nothing but the keyboard moves it there.
    // oxlint-disable-next-line no-await-in-loop -- tab presses must run one after the other
    for (let step = 0; step < 10 && document.activeElement !== trigger; step += 1) await user.tab();
    expect(document.activeElement).toBe(trigger);
    // Focus opens the tooltip, which adds its own id to the description list.
    const descriptions = (trigger.getAttribute("aria-describedby") ?? "")
      .split(" ")
      .map((id) => document.getElementById(id)?.textContent);
    expect(descriptions).toContain("Alpha, Beta");
  });

  it("shows only the count when the server sends no names", () => {
    state.workflows = [summary("a", "Software", { project_count: 2 })];
    open();
    expect(screen.queryByRole("button", { name: "workflows.settings.project_count" })).toBeNull();
    expect(screen.getByText("workflows.settings.project_count")).toBeTruthy();
  });
});
