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
  project_count: 0,
  ...extra,
});
const DUPLICATE = "workflows.settings.duplicate.action";
const DELETE = "workflows.settings.delete.action";

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

describe("duplication", () => {
  it("proposes a copy name and confirms with a toast", async () => {
    const user = open();
    await user.click(screen.getByRole("button", { name: DUPLICATE }));
    await waitFor(() => expect(state.duplicateWorkflow).toHaveBeenCalledWith("ws", "a", "Copy of Software"));
    expect(setToast).toHaveBeenCalledWith(expect.objectContaining({ type: "success" }));
  });

  it("numbers the copy when the name is taken", async () => {
    state.workflows = [summary("a", "Software"), summary("b", "Copy of Software")];
    const user = open();
    await user.click(screen.getAllByRole("button", { name: DUPLICATE })[0]);
    await waitFor(() => expect(state.duplicateWorkflow).toHaveBeenCalledWith("ws", "a", "Copy of Software (2)"));
  });

  it("shows the error toast when the server refuses", async () => {
    state.duplicateWorkflow = vi.fn().mockRejectedValue(new Error("refused"));
    const user = open();
    await user.click(screen.getByRole("button", { name: DUPLICATE }));
    await waitFor(() => expect(setToast).toHaveBeenCalledWith(expect.objectContaining({ type: "error" })));
    expect(setToast).not.toHaveBeenCalledWith(expect.objectContaining({ type: "success" }));
  });
});

describe("deletion", () => {
  it("is inactive, with its reason exposed, while a project uses the workflow", () => {
    state.workflows = [summary("a", "Software", { project_count: 1 })];
    open();
    const button = screen.getByRole("button", { name: DELETE });
    expect(button).toHaveProperty("disabled", true);
    const reason = document.getElementById(button.getAttribute("aria-describedby") ?? "");
    expect(reason?.textContent).toBe("workflows.settings.delete.in_use");
  });

  it("asks for confirmation before removing an unused workflow", async () => {
    const user = open();
    await user.click(screen.getByRole("button", { name: DELETE }));
    expect(state.removeWorkflow).not.toHaveBeenCalled();
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: DELETE }));
    await waitFor(() => expect(state.removeWorkflow).toHaveBeenCalledWith("ws", "a"));
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

describe("write actions", () => {
  it("are hidden from a non-admin", () => {
    state.isAdmin = false;
    open();
    expect(screen.queryByRole("button", { name: DUPLICATE })).toBeNull();
    expect(screen.queryByRole("button", { name: DELETE })).toBeNull();
    expect(screen.queryByRole("link", { name: "workflows.settings.edit" })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "workflows.settings.columns.actions" })).toBeNull();
  });

  it("are shown to an admin", () => {
    open();
    expect(screen.getByRole("button", { name: DUPLICATE })).toBeTruthy();
    expect(screen.getByRole("link", { name: "workflows.settings.edit" })).toBeTruthy();
  });
});
