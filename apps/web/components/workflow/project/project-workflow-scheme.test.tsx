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

const setToast = vi.hoisted(() => vi.fn());
vi.mock("@plane/blocks/toast", () => ({ setToast }));
vi.mock("@/hooks/store/use-work-item-type", () => ({
  useWorkItemType: () => ({ getProjectAssignableTypes: () => state.types }),
}));
vi.mock("@/hooks/store/use-project-state", () => ({
  useProjectState: () => ({ fetchProjectStates: vi.fn().mockResolvedValue([]) }),
}));

// The compat Link adds a trailing slash; the address is what matters.
const hrefOf = (link: HTMLElement) => link.getAttribute("href")?.replace(/\/$/, "");

vi.mock("@plane/i18n", () => ({
  useTranslation: () => ({
    // Lists of names are formatted for the locale: a fixed one keeps the assertions stable.
    currentLocale: "en",
    t: (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key),
  }),
}));

type TNeed = {
  state_id: string;
  state_name: string;
  workflow_id: string;
  issue_count: number;
  auto_status_id: string | null;
};
const state = vi.hoisted(() => ({
  scheme: undefined as TProjectWorkflowScheme | undefined,
  workflows: [] as { id: string; name: string }[],
  types: [] as { id: string; name: string }[],
  canManage: true,
  details: {} as Record<string, { states: { status: { id: string; name: string } }[] }>,
  fetchProjectScheme: vi.fn(),
  previewProjectScheme: vi.fn(),
  applyProjectScheme: vi.fn(),
  detachProjectScheme: vi.fn(),
  fetchWorkflowDetail: vi.fn(),
}));
vi.mock("@/hooks/store/use-workflow", () => ({
  useWorkflow: () => ({
    fetchWorkflows: vi.fn().mockResolvedValue([]),
    getWorkspaceWorkflows: () => state.workflows,
    getProjectScheme: () => state.scheme,
    fetchProjectScheme: (...args: unknown[]) => state.fetchProjectScheme(...args),
    fetchWorkflowDetail: (...args: unknown[]) => state.fetchWorkflowDetail(...args),
    getWorkflowDetail: (id: string) => state.details[id],
    previewProjectScheme: (...args: unknown[]) => state.previewProjectScheme(...args),
    applyProjectScheme: (...args: unknown[]) => state.applyProjectScheme(...args),
    detachProjectScheme: (...args: unknown[]) => state.detachProjectScheme(...args),
  }),
}));
vi.mock("@/hooks/store/user", () => ({
  useUserPermissions: () => ({ allowPermissions: () => state.canManage }),
}));

const graph = (id: string, name: string) => ({
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
  workflows: [graph("w-default", "Software"), graph("w-strict", "Strict")],
});
const strictItems = [
  { issue_type_id: "bug", workflow_id: "w-strict" },
  { issue_type_id: "story", workflow_id: "w-strict" },
];

const S = "workflows.scheme";
const named = (key: string, name: string) => `${S}.${key} ${JSON.stringify({ name })}`;
const button = (name: string) => screen.getByRole("button", { name });
const lastApplied = () => state.applyProjectScheme.mock.calls.at(-1)?.[2];

beforeEach(() => {
  state.scheme = linked();
  state.workflows = [
    { id: "w-default", name: "Software" },
    { id: "w-strict", name: "Strict" },
    { id: "w-free", name: "Kanban" },
  ];
  state.types = [
    { id: "bug", name: "Bug" },
    { id: "story", name: "Story" },
    { id: "task", name: "Task" },
    { id: "epic", name: "Epic" },
  ];
  state.canManage = true;
  state.details = {};
  state.fetchProjectScheme = vi.fn(async () => state.scheme);
  state.previewProjectScheme = vi.fn(async () => [] as TNeed[]);
  state.applyProjectScheme = vi.fn(async () => state.scheme);
  state.detachProjectScheme = vi.fn().mockResolvedValue(undefined);
  state.fetchWorkflowDetail = vi.fn().mockResolvedValue(undefined);
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

describe("linked project", () => {
  it("shows one row per workflow, the default one first", () => {
    open();
    const [, defaultRow, strictRow] = screen.getAllByRole("row");
    expect(hrefOf(within(defaultRow).getByRole("link", { name: "Software" }))).toBe("/ws/settings/workflows/w-default");
    expect(within(defaultRow).getByText(`${S}.default_badge`)).toBeTruthy();
    expect(within(defaultRow).getByText(`${S}.other_types`)).toBeTruthy();
    expect(within(defaultRow).getByRole("button", { name: `${S}.replace` })).toBeTruthy();
    expect(within(strictRow).getByText("Bug, Story")).toBeTruthy();
    expect(within(strictRow).getByRole("button", { name: named("edit_types_named", "Strict") })).toBeTruthy();
    expect(within(strictRow).getByRole("button", { name: named("remove_named", "Strict") })).toBeTruthy();
  });

  it("adds a workflow for types that follow the default one, from the scheme the server holds", async () => {
    const user = open();
    await user.click(button(`${S}.add`));
    const dialog = screen.getByRole("dialog");
    const workflow = within(dialog).getByRole("combobox", { name: `${S}.table.workflow` });
    expect(
      within(workflow)
        .getAllByRole("option")
        .map((item) => item.textContent)
    ).toEqual([`${S}.choose`, "Kanban"]);
    expect(
      within(dialog)
        .getAllByRole("checkbox")
        .map((box) => box.closest("label")?.textContent)
    ).toEqual(["Task", "Epic"]);
    expect(
      within(dialog).getByText(
        `${S}.taken_note ${JSON.stringify({ count: 2, types: "Bug, Story", workflow: "Strict" })}`
      )
    ).toBeTruthy();
    const submit = within(dialog).getByRole("button", { name: `${S}.add_submit` }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    await user.selectOptions(workflow, "Kanban");
    await user.click(within(dialog).getByRole("checkbox", { name: "Task" }));
    await user.click(submit);
    const payload = {
      default_workflow_id: "w-default",
      items: [...strictItems, { issue_type_id: "task", workflow_id: "w-free" }],
      mappings: [],
    };
    await waitFor(() => expect(state.applyProjectScheme).toHaveBeenCalledWith("ws", "p1", payload));
    expect(state.previewProjectScheme).toHaveBeenCalledWith("ws", "p1", payload);
    expect(state.fetchProjectScheme.mock.invocationCallOrder[0]).toBeLessThan(
      state.previewProjectScheme.mock.invocationCallOrder[0]
    );
    expect(setToast).toHaveBeenCalled();
  });

  it("asks where work items go before applying, when some must change state", async () => {
    state.previewProjectScheme = vi.fn(async () => [
      { state_id: "st1", state_name: "Doing", workflow_id: "w-free", issue_count: 3, auto_status_id: null },
    ]);
    state.details = { "w-free": { states: [{ status: { id: "sx", name: "Open" } }] } };
    const user = open();
    await user.click(button(`${S}.add`));
    await user.selectOptions(screen.getByRole("combobox", { name: `${S}.table.workflow` }), "Kanban");
    await user.click(screen.getByRole("checkbox", { name: "Task" }));
    await user.click(button(`${S}.add_submit`));
    const arrival = await screen.findByRole("combobox", { name: /workflows\.scheme\.mapping\.row/ });
    expect(state.applyProjectScheme).not.toHaveBeenCalled();
    const apply = button(`${S}.apply`) as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    await user.selectOptions(arrival, "Open");
    await user.click(apply);
    await waitFor(() => expect(state.applyProjectScheme).toHaveBeenCalledTimes(1));
    expect(lastApplied().mappings).toEqual([{ state_id: "st1", workflow_id: "w-free", status_id: "sx" }]);
  });

  it("changes the types of a workflow", async () => {
    const user = open();
    await user.click(button(named("edit_types_named", "Strict")));
    const dialog = screen.getByRole("dialog");
    const boxes = within(dialog).getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes.map((box) => [box.closest("label")?.textContent, box.checked])).toEqual([
      ["Bug", true],
      ["Story", true],
      ["Task", false],
      ["Epic", false],
    ]);
    await user.click(within(dialog).getByRole("checkbox", { name: "Story" }));
    await user.click(within(dialog).getByRole("checkbox", { name: "Task" }));
    await user.click(within(dialog).getByRole("button", { name: `${S}.apply` }));
    await waitFor(() => expect(state.applyProjectScheme).toHaveBeenCalledTimes(1));
    expect(lastApplied().items).toEqual([
      { issue_type_id: "bug", workflow_id: "w-strict" },
      { issue_type_id: "task", workflow_id: "w-strict" },
    ]);
  });

  it("removes a workflow after a confirmation that names its types", async () => {
    const user = open();
    await user.click(button(named("remove_named", "Strict")));
    expect(
      screen.getByText(`${S}.remove_confirm ${JSON.stringify({ count: 2, types: "Bug, Story", default: "Software" })}`)
    ).toBeTruthy();
    expect(state.applyProjectScheme).not.toHaveBeenCalled();
    await user.click(button(`${S}.remove`));
    await waitFor(() => expect(state.applyProjectScheme).toHaveBeenCalledTimes(1));
    expect(lastApplied()).toEqual({ default_workflow_id: "w-default", items: [], mappings: [] });
  });

  it("replaces the default workflow", async () => {
    const user = open();
    await user.click(button(`${S}.replace`));
    const dialog = screen.getByRole("dialog");
    await user.selectOptions(within(dialog).getByRole("combobox", { name: `${S}.table.workflow` }), "Kanban");
    await user.click(within(dialog).getByRole("button", { name: `${S}.replace` }));
    await waitFor(() => expect(state.applyProjectScheme).toHaveBeenCalledTimes(1));
    expect(lastApplied()).toEqual({ default_workflow_id: "w-free", items: strictItems, mappings: [] });
  });

  it("says why no workflow can be added when every one is in the table", () => {
    state.workflows = state.workflows.slice(0, 2);
    open();
    expect((button(`${S}.add`) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(`${S}.no_workflow`)).toBeTruthy();
    // The reason is read with the button, not only seen next to it.
    const reason = document.getElementById(button(`${S}.add`).getAttribute("aria-describedby") ?? "");
    expect(reason?.textContent).toBe(`${S}.no_workflow`);
  });

  // I5: the row and its "Remove" are gone once applied; the table keeps the keyboard user in place.
  it("gives the focus to the table once a workflow is removed", async () => {
    const user = open();
    await user.click(button(named("remove_named", "Strict")));
    state.applyProjectScheme = vi.fn(async () => {
      state.scheme = { ...linked(), items: [] };
      return state.scheme;
    });
    await user.click(button(`${S}.remove`));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("table")));
  });

  // The last free workflow added, "Add a workflow" is disabled and can no longer take the focus back.
  it("gives the focus to the table once the last free workflow is added", async () => {
    state.applyProjectScheme = vi.fn(async () => {
      state.scheme = { ...linked(), items: [...strictItems, { issue_type_id: "task", workflow_id: "w-free" }] };
      return state.scheme;
    });
    const user = open();
    await user.click(button(`${S}.add`));
    const dialog = screen.getByRole("dialog");
    await user.selectOptions(within(dialog).getByRole("combobox", { name: `${S}.table.workflow` }), "Kanban");
    await user.click(within(dialog).getByRole("checkbox", { name: "Task" }));
    await user.click(within(dialog).getByRole("button", { name: `${S}.add_submit` }));
    await waitFor(() => expect((button(`${S}.add`) as HTMLButtonElement).disabled).toBe(true));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("table")));
  });

  it("shows a refusal of the server in the dialog", async () => {
    state.previewProjectScheme = vi.fn().mockRejectedValue({ scheme: ["invalid_scheme"] });
    const user = open();
    await user.click(button(`${S}.replace`));
    await user.selectOptions(screen.getByRole("combobox", { name: `${S}.table.workflow` }), "Kanban");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: `${S}.replace` }));
    expect((await screen.findByRole("alert")).textContent).toBe(`${S}.errors.invalid_scheme`);
    expect(state.applyProjectScheme).not.toHaveBeenCalled();
  });

  it("offers no action to who cannot manage the project", () => {
    state.canManage = false;
    open();
    expect(screen.queryAllByRole("button")).toEqual([]);
    expect(screen.getByRole("link", { name: "Strict" })).toBeTruthy();
  });

  it("stops using workflows after a confirmation", async () => {
    const user = open();
    await user.click(button(`${S}.detach`));
    expect(screen.getByText(`${S}.detach_confirm`)).toBeTruthy();
    const confirm = screen.getAllByRole("button", { name: `${S}.detach` }).at(-1) as HTMLElement;
    await user.click(confirm);
    await waitFor(() => expect(state.detachProjectScheme).toHaveBeenCalledWith("ws", "p1"));
  });

  it("starts every change from the scheme the server holds, not the copy on screen", async () => {
    state.fetchProjectScheme = vi.fn(async () => ({
      ...linked(),
      items: [...strictItems, { issue_type_id: "task", workflow_id: "w-free" }],
    }));
    const user = open();
    await user.click(button(named("edit_types_named", "Strict")));
    await user.click(within(screen.getByRole("dialog")).getByRole("checkbox", { name: "Story" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: `${S}.apply` }));
    await waitFor(() => expect(state.applyProjectScheme).toHaveBeenCalledTimes(1));
    expect(lastApplied().items).toEqual([
      { issue_type_id: "task", workflow_id: "w-free" },
      { issue_type_id: "bug", workflow_id: "w-strict" },
    ]);
  });

  it("keeps the dialog usable after a failed preview, and applies on the next try", async () => {
    state.previewProjectScheme = vi
      .fn()
      .mockRejectedValueOnce({ scheme: ["invalid_scheme"] })
      .mockResolvedValue([]);
    const user = open();
    await user.click(button(`${S}.replace`));
    const dialog = screen.getByRole("dialog");
    await user.selectOptions(within(dialog).getByRole("combobox", { name: `${S}.table.workflow` }), "Kanban");
    const submit = within(dialog).getByRole("button", { name: `${S}.replace` });
    await user.click(submit);
    expect((await screen.findByRole("alert")).textContent).toBe(`${S}.errors.invalid_scheme`);
    expect(submit.matches(":disabled")).toBe(false);
    await user.click(submit);
    await waitFor(() => expect(state.applyProjectScheme).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps the dialog usable after a failed apply, and applies on the next try", async () => {
    state.applyProjectScheme = vi
      .fn()
      .mockRejectedValueOnce({ scheme: ["invalid_scheme"] })
      .mockResolvedValue(undefined);
    const user = open();
    await user.click(button(`${S}.replace`));
    const dialog = screen.getByRole("dialog");
    await user.selectOptions(within(dialog).getByRole("combobox", { name: `${S}.table.workflow` }), "Kanban");
    const submit = within(dialog).getByRole("button", { name: `${S}.replace` });
    await user.click(submit);
    expect((await screen.findByRole("alert")).textContent).toBe(`${S}.errors.invalid_scheme`);
    expect(submit.matches(":disabled")).toBe(false);
    await user.click(submit);
    await waitFor(() => expect(state.applyProjectScheme).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("shows a failed detach, and clears the error on the next detach", async () => {
    state.detachProjectScheme = vi
      .fn()
      .mockRejectedValueOnce({ scheme: ["invalid_scheme"] })
      .mockResolvedValue(undefined);
    const user = open();
    const detachAndConfirm = async () => {
      await user.click(button(`${S}.detach`));
      await user.click(screen.getAllByRole("button", { name: `${S}.detach` }).at(-1) as HTMLElement);
    };
    await detachAndConfirm();
    expect((await screen.findByRole("alert")).textContent).toBe(`${S}.errors.invalid_scheme`);
    await detachAndConfirm();
    await waitFor(() => expect(state.detachProjectScheme).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("shows a fallback label for a workflow or a type the lists do not know", () => {
    state.scheme = {
      default_workflow_id: "w-default",
      items: [{ issue_type_id: "ghost", workflow_id: "w-gone" }],
      workflows: [],
    };
    open();
    const row = screen.getAllByRole("row")[2];
    expect(within(row).getByRole("link", { name: `${S}.table.unknown_workflow` })).toBeTruthy();
    expect(within(row).getByText("-")).toBeTruthy();
  });
});

describe("project without a workflow", () => {
  it("offers no action to who cannot manage the project", () => {
    state.scheme = { default_workflow_id: null, items: [], workflows: [] };
    state.canManage = false;
    open();
    expect(screen.getByText(`${S}.free`)).toBeTruthy();
    expect(screen.queryAllByRole("button")).toEqual([]);
  });

  beforeEach(() => {
    state.scheme = { default_workflow_id: null, items: [], workflows: [] };
  });

  it("links a first workflow, which becomes the default one for every type", async () => {
    const user = open();
    expect(screen.getByText(`${S}.free`)).toBeTruthy();
    await user.click(button(`${S}.link`));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByRole("checkbox")).toBeNull();
    expect(within(dialog).getByText(`${S}.link_note`)).toBeTruthy();
    await user.selectOptions(within(dialog).getByRole("combobox", { name: `${S}.table.workflow` }), "Software");
    await user.click(within(dialog).getByRole("button", { name: `${S}.link_submit` }));
    await waitFor(() => expect(state.applyProjectScheme).toHaveBeenCalledTimes(1));
    expect(lastApplied()).toEqual({ default_workflow_id: "w-default", items: [], mappings: [] });
  });

  it("gives the focus to the new table once a workflow is linked", async () => {
    state.applyProjectScheme = vi.fn(async () => {
      state.scheme = linked();
      return state.scheme;
    });
    const user = open();
    await user.click(button(`${S}.link`));
    const dialog = screen.getByRole("dialog");
    await user.selectOptions(within(dialog).getByRole("combobox", { name: `${S}.table.workflow` }), "Software");
    await user.click(within(dialog).getByRole("button", { name: `${S}.link_submit` }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("table")));
  });
});
