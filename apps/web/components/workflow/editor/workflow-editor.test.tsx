/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TWorkflowDetail, TWorkflowGraphPayload, TWorkflowStatus, TWorkflowStatusCandidate } from "@plane/types";
import { WorkflowEditor } from "./workflow-editor";

vi.mock("@plane/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@plane/blocks/toast", () => ({ setToast: vi.fn() }));
// The rule form reads the member store; it is out of scope here.
vi.mock("./restrict-actors-form", () => ({ RestrictActorsForm: () => null }));

const statusOf = (id: string, name: string): TWorkflowStatus => ({
  id,
  name,
  color: "#3A3A3A",
  group: "started",
  group_is_auto: true,
  workflow_count: 1,
});
const workflow: TWorkflowDetail = {
  id: "w",
  name: "Software",
  description: "",
  updated_at: null,
  project_count: 2,
  projects: [
    { id: "p1", name: "Alpha" },
    { id: "p2", name: "Beta" },
  ],
  states: [
    { id: "a", status: statusOf("sa", "Todo"), position_x: 0, position_y: 0, is_initial: true },
    { id: "b", status: statusOf("sb", "Done"), position_x: 240, position_y: 0, is_initial: false },
  ],
  transitions: [{ id: "t", name: "Finish", from_any: false, source_ids: ["a"], target_id: "b", rules: [], sides: {} }],
};
const statuses = [statusOf("sa", "Todo"), statusOf("sb", "Done")];
const candidates: TWorkflowStatusCandidate[] = [{ name: "Review", color: "#333333", group: "started" }];

const editorOf = (props: Partial<React.ComponentProps<typeof WorkflowEditor>> = {}) => (
  <div style={{ width: 1280, height: 800 }}>
    <WorkflowEditor
      workflow={workflow}
      statuses={statuses}
      candidates={candidates}
      readOnly={false}
      onSave={async () => workflow}
      onClose={() => {}}
      {...props}
    />
  </div>
);
const renderEditor = (props: Partial<React.ComponentProps<typeof WorkflowEditor>> = {}) => render(editorOf(props));
const TOOLS = [
  "workflows.editor.add_state.title",
  "workflows.editor.add_transition.title",
  "workflows.editor.add_rule.title",
  "workflows.editor.save",
];
const expectNoEditingTool = () => {
  for (const name of TOOLS) expect(screen.queryByRole("button", { name })).toBeNull();
};

const addReview = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("button", { name: "workflows.editor.add_state.title" }));
  await user.click(screen.getByRole("checkbox", { name: /Review/ }));
  await user.click(screen.getByRole("button", { name: "workflows.editor.add_state.submit" }));
};

afterEach(() => vi.restoreAllMocks());

describe("WorkflowEditor", () => {
  it("opens a workflow that has states", () => {
    renderEditor();
    expect(screen.getByRole("heading", { name: "Software" })).toBeTruthy();
    expect(screen.getByText("workflows.editor.start")).toBeTruthy();
    expect(screen.getByText("Todo")).toBeTruthy();
    expect(screen.getByText("Done")).toBeTruthy();
    expect(screen.getByRole("button", { name: "workflows.editor.save" })).toHaveProperty("disabled", true);
  });

  it("shows no editing tool to a reader", () => {
    renderEditor({ readOnly: true });
    expect(screen.getByRole("status").textContent).toBe("workflows.editor.read_only");
    expectNoEditingTool();
    expect(screen.getByRole("button", { name: "workflows.editor.close" })).toBeTruthy();
  });

  // Project names only reach admins (P6): without them the count is plain text, not a toggle that opens on nothing.
  it("lists the projects behind the count only when it receives their names", () => {
    const view = renderEditor();
    expect(screen.getByText("workflows.editor.used_in").closest("summary")).toBeTruthy();
    view.unmount();
    renderEditor({ workflow: { ...workflow, projects: undefined }, readOnly: true });
    expect(screen.getByText("workflows.editor.used_in").closest("summary, details")).toBeNull();
  });

  it("adds a ticked state and saves the graph", async () => {
    const onSave = vi.fn(async (_payload: TWorkflowGraphPayload) => workflow);
    renderEditor({ onSave });
    const user = userEvent.setup();
    await addReview(user);
    expect(screen.getAllByText("Review").length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "workflows.editor.save" }));
    expect(onSave).toHaveBeenCalledTimes(1);
    const payload = onSave.mock.calls[0][0];
    expect(payload.states.map((item) => item.status.name)).toEqual(["Todo", "Done", "Review"]);
    expect(payload.states[2].position_x).toBe(480);
  });

  it("switches to the text view and opens the panel of a selected state", async () => {
    renderEditor();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "workflows.editor.view.text" }));
    expect(screen.getByRole("table")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByRole("heading", { name: "workflows.editor.panel.state" })).toBeTruthy();
  });

  it("discards unsaved changes", async () => {
    renderEditor();
    const user = userEvent.setup();
    await addReview(user);
    await user.click(screen.getByRole("button", { name: "workflows.editor.discard" }));
    expect(screen.queryByText("Review")).toBeNull();
    expect(screen.getByRole("button", { name: "workflows.editor.close" })).toBeTruthy();
  });

  it("closes through the injected handler while nothing changed", async () => {
    const onClose = vi.fn();
    renderEditor({ onClose });
    await userEvent.setup().click(screen.getByRole("button", { name: "workflows.editor.close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("moves the focus to the node of the last added state (spec 3.3)", async () => {
    renderEditor();
    await addReview(userEvent.setup());
    await waitFor(() => {
      const active = document.activeElement as HTMLElement;
      expect(active.classList.contains("react-flow__node")).toBe(true);
      expect(active.textContent).toContain("Review");
    });
  });

  it("moves the focus to the row of the last added state in the text view", async () => {
    renderEditor();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "workflows.editor.view.text" }));
    await addReview(user);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Review" })));
  });

  it("gives the focus back to the header tool that opened a dialog (spec 3.9)", async () => {
    renderEditor();
    const user = userEvent.setup();
    const trigger = screen.getByRole("button", { name: "workflows.editor.add_transition.title" });
    await user.click(trigger);
    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("forgets a removed transition, even once a discard brings it back", async () => {
    renderEditor();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "workflows.editor.view.text" }));
    await user.click(screen.getByRole("button", { name: /^Finish/ }));
    expect(screen.getByRole("heading", { name: "workflows.editor.panel.transition" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "workflows.editor.panel.remove_transition" }));
    await user.click(screen.getByRole("button", { name: "workflows.editor.discard" }));
    expect(screen.getByRole("button", { name: /^Finish/ })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "workflows.editor.panel.transition" })).toBeNull();
    expect(screen.getByRole("heading", { name: "workflows.editor.panel.empty_title" })).toBeTruthy();
  });

  it("keeps the selection of a state still in the graph after a discard", async () => {
    renderEditor();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "workflows.editor.view.text" }));
    await user.click(screen.getByRole("button", { name: "Done" }));
    await user.type(screen.getByRole("textbox", { name: "workflows.editor.add_state.name" }), "!");
    await user.click(screen.getByRole("button", { name: "workflows.editor.discard" }));
    expect(screen.getByRole("textbox", { name: "workflows.editor.add_state.name" })).toHaveProperty("value", "Done");
  });

  it("shows the shared warning from the statuses refreshed by the save (W17)", async () => {
    const reviewed: TWorkflowDetail = {
      ...workflow,
      states: [
        ...workflow.states,
        { id: "c", status: statusOf("sr", "Review"), position_x: 480, position_y: 0, is_initial: false },
      ],
    };
    // The store refreshes the statuses before saveGraph resolves; the page re-renders with them.
    const fresh = [...statuses, { ...statusOf("sr", "Review"), workflow_count: 2 }];
    const view = renderEditor({
      onSave: async () => {
        view.rerender(editorOf({ statuses: fresh, onSave: async () => reviewed }));
        return reviewed;
      },
    });
    const user = userEvent.setup();
    await addReview(user);
    await user.click(screen.getByRole("button", { name: "workflows.editor.save" }));
    await user.click(screen.getByRole("button", { name: "workflows.editor.view.text" }));
    await user.click(screen.getByRole("button", { name: "Review" }));
    expect(screen.getByRole("note").textContent).toBe("workflows.editor.panel.shared");
  });

  it("expands the collapsed panel on a new selection and focuses its heading", async () => {
    renderEditor();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "workflows.editor.panel.collapse" }));
    await user.click(screen.getByRole("button", { name: "workflows.editor.view.text" }));
    await user.click(screen.getByRole("button", { name: "Done" }));
    const heading = screen.getByRole("heading", { name: "workflows.editor.panel.state" });
    await waitFor(() => expect(document.activeElement).toBe(heading));
  });

  it("expands the collapsed panel on a selection in the diagram", async () => {
    renderEditor();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "workflows.editor.panel.collapse" }));
    // A click without the mousedown that React Flow's drag handler cannot run under jsdom.
    fireEvent.click(screen.getByText("Done"));
    expect(screen.getByRole("heading", { name: "workflows.editor.panel.state" })).toBeTruthy();
  });

  it("expands the collapsed panel on a click on the state already selected in the diagram", async () => {
    renderEditor();
    const user = userEvent.setup();
    fireEvent.click(screen.getByText("Done"));
    await user.click(screen.getByRole("button", { name: "workflows.editor.panel.collapse" }));
    expect(screen.queryByRole("heading", { name: "workflows.editor.panel.state" })).toBeNull();
    fireEvent.click(screen.getByText("Done"));
    expect(screen.getByRole("heading", { name: "workflows.editor.panel.state" })).toBeTruthy();
  });

  it("points the skip link at the view shown", async () => {
    renderEditor();
    expect(screen.getByRole("link", { name: "workflows.editor.diagram_label" })).toBeTruthy();
    expect(screen.getByRole("main").getAttribute("tabindex")).toBe("-1");
    await userEvent.setup().click(screen.getByRole("button", { name: "workflows.editor.view.text" }));
    expect(screen.getByRole("link", { name: "workflows.editor.view.text" })).toBeTruthy();
  });

  it("shows the empty panel once the selected state is removed", async () => {
    renderEditor();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "workflows.editor.view.text" }));
    await user.click(screen.getByRole("button", { name: "Done" }));
    await user.click(screen.getByRole("button", { name: "workflows.editor.panel.remove_state" }));
    expect(screen.queryByRole("heading", { name: "workflows.editor.panel.state" })).toBeNull();
    expect(screen.getByRole("heading", { name: "workflows.editor.panel.empty_title" })).toBeTruthy();
  });

  it("lists draft errors in the alert banner, each selecting its element (spec 3.8)", async () => {
    renderEditor();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "workflows.editor.view.text" }));
    await user.click(screen.getByRole("button", { name: "Done" }));
    const name = screen.getByRole("textbox", { name: "workflows.editor.add_state.name" });
    await user.clear(name);
    await user.type(name, "todo");
    expect(screen.getByRole("button", { name: "workflows.editor.save" })).toHaveProperty("disabled", true);
    await user.click(screen.getByRole("button", { name: "Todo" }));
    expect(screen.getByRole("textbox", { name: "workflows.editor.add_state.name" })).toHaveProperty("value", "Todo");
    const banner = screen.getByRole("alert");
    await user.click(within(banner).getByRole("button", { name: "workflows.editor.errors.duplicate_status_name" }));
    expect(screen.getByRole("textbox", { name: "workflows.editor.add_state.name" })).toHaveProperty("value", "todo");
  });

  it("shows a server refusal in the same alert banner", async () => {
    const onSave = vi.fn(async () => {
      throw { graph: ["status_in_use"], projects: [{ project_id: "p1", project_name: "Alpha", issue_count: 3 }] };
    });
    renderEditor({ onSave });
    const user = userEvent.setup();
    await addReview(user);
    await user.click(screen.getByRole("button", { name: "workflows.editor.save" }));
    const banner = await screen.findByRole("alert");
    expect(banner.textContent).toContain("workflows.editor.errors.status_in_use");
    expect(banner.textContent).toContain("workflows.editor.errors.status_in_use_project");
  });

  it("opens on the text view without editing tools below 768px (X13)", () => {
    vi.spyOn(window, "matchMedia").mockImplementation(
      (query: string) => ({ matches: query === "(max-width: 767px)", media: query }) as MediaQueryList
    );
    renderEditor();
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("workflows.editor.small_screen");
    expectNoEditingTool();
  });
});
