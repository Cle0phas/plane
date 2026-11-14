/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TProjectWorkflowScheme } from "@plane/types";
import { ProjectWorkflowScheme } from "./project-workflow-scheme";

// Real t is a new function on every render, which would re-run effects guarded by it.
vi.mock("@plane/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const setToast = vi.hoisted(() => vi.fn());
vi.mock("@plane/blocks/toast", () => ({ setToast }));

const state = vi.hoisted(() => ({
  scheme: undefined as TProjectWorkflowScheme | undefined,
  types: [] as { id: string; name: string }[],
  isWorkspaceAdmin: true,
  isProjectAdmin: true,
  detachProjectScheme: vi.fn(),
}));
vi.mock("@/hooks/store/use-workflow", () => ({
  useWorkflow: () => ({
    fetchWorkflows: vi.fn().mockResolvedValue([]),
    getWorkspaceWorkflows: () => state.scheme?.workflows ?? [],
    getProjectScheme: () => state.scheme,
    fetchWorkflowDetail: vi.fn(),
    getWorkflowDetail: () => undefined,
    previewProjectScheme: vi.fn(),
    applyProjectScheme: vi.fn(),
    detachProjectScheme: state.detachProjectScheme,
  }),
}));
vi.mock("@/hooks/store/use-work-item-type", () => ({
  useWorkItemType: () => ({ getProjectAssignableTypes: () => state.types }),
}));
vi.mock("@/hooks/store/use-project-state", () => ({
  useProjectState: () => ({ fetchProjectStates: vi.fn().mockResolvedValue([]) }),
}));
vi.mock("@/hooks/store/user", () => ({
  useUserPermissions: () => ({
    allowPermissions: (_roles: unknown, level: string) =>
      level === "PROJECT" ? state.isProjectAdmin : state.isWorkspaceAdmin,
  }),
}));

const workflow = (id: string, name: string) => ({
  id,
  name,
  description: "",
  updated_at: null,
  states: [],
  transitions: [],
});
const linked = (): TProjectWorkflowScheme => ({
  default_workflow_id: "w-default",
  items: [
    { issue_type_id: "bug", workflow_id: "w-strict" },
    { issue_type_id: "story", workflow_id: "w-strict" },
  ],
  workflows: [workflow("w-default", "Software"), workflow("w-strict", "Strict")],
});

// The compat Link adds a trailing slash; the address is what matters.
const hrefOf = (link: HTMLElement) => link.getAttribute("href")?.replace(/\/$/, "");

const LINK = "workflows.scheme.link";
const CHANGE = "workflows.scheme.change";
const DETACH = "workflows.scheme.detach";
const EDIT = "workflows.scheme.edit_workflow";

beforeEach(() => {
  state.scheme = linked();
  state.types = [
    { id: "bug", name: "Bug" },
    { id: "story", name: "Story" },
  ];
  state.isWorkspaceAdmin = true;
  state.isProjectAdmin = true;
  state.detachProjectScheme = vi.fn().mockResolvedValue(undefined);
  setToast.mockClear();
});

const open = () => {
  render(
    <MemoryRouter>
      <ProjectWorkflowScheme workspaceSlug="ws" projectId="p1" />
    </MemoryRouter>
  );
  return userEvent.setup();
};

describe("project without a scheme", () => {
  beforeEach(() => {
    state.scheme = { default_workflow_id: null, items: [], workflows: [workflow("w-default", "Software")] };
  });

  it("explains it and offers to link, with no table", () => {
    open();
    expect(screen.getByText("workflows.scheme.free")).toBeTruthy();
    expect(screen.getByRole("button", { name: LINK })).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("opens the wizard on the button and cancel brings back the initial state", async () => {
    const user = open();
    await user.click(screen.getByRole("button", { name: LINK }));
    expect(screen.getByRole("combobox", { name: "workflows.scheme.default_workflow" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: LINK })).toBeNull();
    await user.click(screen.getByRole("button", { name: "workflows.settings.form.cancel" }));
    expect(screen.getByRole("button", { name: LINK })).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
  });
});

describe("linked project", () => {
  it("lists the default workflow with the other types, then each other workflow with its types", () => {
    open();
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    expect(hrefOf(within(rows[0]).getByRole("link", { name: "Software" }))).toBe("/ws/settings/workflows/w-default");
    expect(within(rows[0]).getByText("workflows.scheme.other_types")).toBeTruthy();
    expect(hrefOf(within(rows[1]).getByRole("link", { name: "Strict" }))).toBe("/ws/settings/workflows/w-strict");
    expect(within(rows[1]).getByText("Bug, Story")).toBeTruthy();
    expect(screen.getAllByRole("columnheader")).toHaveLength(3);
  });

  it("shows a placeholder, not a crash, for a workflow or a type the stores do not know", () => {
    state.scheme = {
      default_workflow_id: "w-default",
      items: [{ issue_type_id: "ghost", workflow_id: "w-gone" }],
      workflows: [workflow("w-default", "Software")],
    };
    open();
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[1]).getByRole("link", { name: "-" }).getAttribute("href")).toMatch(
      new RegExp("^/ws/settings/workflows/w-gone/?$")
    );
    expect(within(rows[1]).getAllByText("-").length).toBeGreaterThan(1);
  });

  it("shows the edit link only to a workspace admin", () => {
    state.isWorkspaceAdmin = false;
    open();
    expect(screen.queryByRole("link", { name: EDIT })).toBeNull();
    expect(screen.getByRole("link", { name: "Software" })).toBeTruthy();
  });

  it("shows the edit link to a workspace admin", () => {
    open();
    expect(screen.getAllByRole("link", { name: EDIT })).toHaveLength(2);
  });

  it("shows change and detach to who may change the scheme", () => {
    open();
    expect(screen.getByRole("button", { name: CHANGE })).toBeTruthy();
    expect(screen.getByRole("button", { name: DETACH })).toBeTruthy();
  });

  it("shows the table and no action to a reader who may do neither", () => {
    state.isWorkspaceAdmin = false;
    state.isProjectAdmin = false;
    open();
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("link", { name: EDIT })).toBeNull();
  });

  it("offers no link button to a reader of a project without a scheme", () => {
    state.isProjectAdmin = false;
    state.scheme = { default_workflow_id: null, items: [], workflows: [] };
    open();
    expect(screen.getByText("workflows.scheme.free")).toBeTruthy();
    expect(screen.queryByRole("button", { name: LINK })).toBeNull();
  });

  it("asks for confirmation before detaching", async () => {
    const user = open();
    await user.click(screen.getByRole("button", { name: DETACH }));
    expect(state.detachProjectScheme).not.toHaveBeenCalled();
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: DETACH }));
    await waitFor(() => expect(state.detachProjectScheme).toHaveBeenCalledWith("ws", "p1"));
  });
});
