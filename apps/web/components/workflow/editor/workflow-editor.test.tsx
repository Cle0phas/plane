/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  TWorkflowDetail,
  TWorkflowGraphSavePayload,
  TWorkflowStatus,
  TWorkflowStatusCandidate,
} from "@plane/types";
import { WorkflowEditor } from "./workflow-editor";

// The panel formats lists of names for the language.
vi.mock("@plane/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key, currentLocale: "en" }) }));
vi.mock("@plane/blocks/toast", () => ({ setToast: vi.fn() }));
// The rule form reads the member store; it is out of scope here.
vi.mock("./restrict-actors-form", () => ({ RestrictActorsForm: () => null }));
// Integration tests of the whole editor in jsdom: slow under machine load, not a product defect.
vi.setConfig({ testTimeout: 15_000 });

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
  version: "v1",
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
      onReload={async () => {}}
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
  it("adds a transition towards a state taken from the other existing states", async () => {
    const onSave = vi.fn(async (_payload: TWorkflowGraphSavePayload) => workflow);
    renderEditor({ onSave });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "workflows.editor.add_transition.title" }));
    await user.click(screen.getByRole("checkbox", { name: "Todo" }));
    await user.selectOptions(
      screen.getByRole("combobox", { name: "workflows.editor.add_transition.target" }),
      "Review"
    );
    await user.click(screen.getByRole("button", { name: "workflows.editor.add_transition.submit" }));
    await waitFor(() => expect(screen.getAllByText("Review").length).toBeGreaterThan(0));
    await user.click(screen.getByRole("button", { name: "workflows.editor.save" }));
    const payload = onSave.mock.calls[0][0];
    expect(payload.states.map((item) => item.status.name)).toEqual(["Todo", "Done", "Review"]);
    expect(payload.states[2].is_initial).toBe(false);
    expect(payload.transitions[1]).toMatchObject({
      from_any: false,
      source_keys: ["a"],
      target_key: payload.states[2].key,
    });
  });

  it("locks the target of a transition added from the panel of a state", async () => {
    renderEditor();
    const user = userEvent.setup();
    fireEvent.click(screen.getByText("Done"));
    await user.click(screen.getByRole("button", { name: "workflows.editor.panel.add_incoming" }));
    const locked = screen.getByRole("textbox", { name: "workflows.editor.add_transition.target" }) as HTMLInputElement;
    expect(locked.value).toBe("Done");
    expect(locked.readOnly).toBe(true);
  });

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

  // Spec 3.8: a reader gets the panel without any action.
  it("shows a reader the panel of a state and of a transition without any action", async () => {
    renderEditor({ readOnly: true });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "workflows.editor.view.text" }));
    await user.click(screen.getByRole("button", { name: "Done" }));
    // Disabled through the panel's fieldset, so :disabled rather than the element's own attribute.
    expect(screen.getByRole("textbox", { name: "workflows.editor.add_state.name" }).matches(":disabled")).toBe(true);
    for (const name of [
      "workflows.editor.panel.remove_state",
      "workflows.editor.panel.set_initial",
      "workflows.editor.panel.add_incoming",
      "workflows.editor.panel.add_outgoing",
    ])
      expect(screen.queryByRole("button", { name })).toBeNull();
    // The cards of the state's transitions still select them: reading is allowed.
    await user.click(within(screen.getByRole("complementary")).getByRole("button", { name: /^Finish/ }));
    expect(screen.getByRole("heading", { level: 2, name: "Finish" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "workflows.editor.add_transition.name" }).matches(":disabled")).toBe(
      true
    );
    expect(screen.queryByRole("button", { name: "workflows.editor.panel.remove_transition" })).toBeNull();
    expect(screen.queryByRole("button", { name: /workflows\.editor\.panel\.remove_source/ })).toBeNull();
  });

  // CA-17: a refresh under a dirty draft must not hand the server the version of a graph the draft ignores.
  it("sends back the version of the workflow it was opened on", async () => {
    const onSave = vi.fn(async (_payload: TWorkflowGraphSavePayload) => workflow);
    const view = renderEditor({ onSave });
    const user = userEvent.setup();
    await addReview(user);
    const [todo, done] = workflow.states;
    const refreshed = { ...workflow, version: "v2", states: [todo, { ...done, position_x: 600 }] };
    view.rerender(editorOf({ workflow: refreshed, onSave }));
    await user.click(screen.getByRole("button", { name: "workflows.editor.save" }));
    expect(onSave.mock.calls[0][0].expected_version).toBe("v1");
  });

  it("sends the version of its last save on the next one", async () => {
    const onSave = vi.fn(async (_payload: TWorkflowGraphSavePayload) => ({ ...workflow, version: "v2" }));
    renderEditor({ onSave });
    const user = userEvent.setup();
    await addReview(user);
    await user.click(screen.getByRole("button", { name: "workflows.editor.save" }));
    await addReview(user);
    await user.click(screen.getByRole("button", { name: "workflows.editor.save" }));
    expect(onSave.mock.calls.map(([payload]) => payload.expected_version)).toEqual(["v1", "v2"]);
  });

  it("adds a ticked state and saves the graph", async () => {
    const onSave = vi.fn(async (_payload: TWorkflowGraphSavePayload) => workflow);
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
    expect(screen.getByRole("heading", { level: 2, name: "Done" })).toBeTruthy();
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
    expect(screen.getByRole("heading", { level: 2, name: "Finish" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "workflows.editor.panel.remove_transition" }));
    await user.click(screen.getByRole("button", { name: "workflows.editor.discard" }));
    expect(screen.getByRole("button", { name: /^Finish/ })).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 2, name: "Finish" })).toBeNull();
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
    const fresh = [
      ...statuses,
      {
        ...statusOf("sr", "Review"),
        workflow_count: 2,
        workflows: [
          { id: "w2", name: "Bug" },
          { id: workflow.id, name: workflow.name },
        ],
      },
    ];
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
    expect(screen.getByRole("note").textContent).toBe("workflows.editor.panel.shared_named");
  });

  it("expands the collapsed panel on a new selection and focuses its heading", async () => {
    renderEditor();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "workflows.editor.panel.collapse" }));
    await user.click(screen.getByRole("button", { name: "workflows.editor.view.text" }));
    await user.click(screen.getByRole("button", { name: "Done" }));
    const heading = screen.getByRole("heading", { level: 2, name: "Done" });
    await waitFor(() => expect(document.activeElement).toBe(heading));
  });

  it("expands the collapsed panel on a selection in the diagram", async () => {
    renderEditor();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "workflows.editor.panel.collapse" }));
    // A click without the mousedown that React Flow's drag handler cannot run under jsdom.
    fireEvent.click(screen.getByText("Done"));
    expect(screen.getByRole("heading", { level: 2, name: "Done" })).toBeTruthy();
  });

  it("expands the collapsed panel on a click on the state already selected in the diagram", async () => {
    renderEditor();
    const user = userEvent.setup();
    fireEvent.click(screen.getByText("Done"));
    await user.click(screen.getByRole("button", { name: "workflows.editor.panel.collapse" }));
    expect(screen.queryByRole("heading", { level: 2, name: "Done" })).toBeNull();
    fireEvent.click(screen.getByText("Done"));
    expect(screen.getByRole("heading", { level: 2, name: "Done" })).toBeTruthy();
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
    expect(screen.queryByRole("heading", { level: 2, name: "Done" })).toBeNull();
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
    // Spec 3.8: a refused save keeps every edit, ready to be corrected and saved again.
    expect(screen.getAllByText("Review").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "workflows.editor.discard" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "workflows.editor.save" })).toHaveProperty("disabled", false);
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

it("blocks the save until the start is linked again", async () => {
  renderEditor();
  const user = userEvent.setup();
  const save = () => screen.getByRole("button", { name: "workflows.editor.save" }) as HTMLButtonElement;
  fireEvent.click(screen.getByText("workflows.editor.start"));
  await user.click(screen.getByRole("button", { name: "workflows.editor.start_panel.unlink" }));
  const banner = screen.getByRole("alert");
  expect(within(banner).getByRole("button", { name: "workflows.editor.errors.initial_state_required" })).toBeTruthy();
  expect(save().disabled).toBe(true);
  await user.selectOptions(screen.getByRole("combobox", { name: "workflows.editor.start_panel.field" }), "Done");
  expect(screen.queryByRole("alert")).toBeNull();
  expect(save().disabled).toBe(false);
});

it("opens the start panel from the banner line", async () => {
  renderEditor();
  const user = userEvent.setup();
  fireEvent.click(screen.getByText("workflows.editor.start"));
  await user.click(screen.getByRole("button", { name: "workflows.editor.start_panel.unlink" }));
  // The panel select also lists "Todo": pick the node inside the diagram.
  fireEvent.click(within(screen.getByRole("group", { name: "workflows.editor.diagram_label" })).getByText("Todo"));
  await user.click(screen.getByRole("button", { name: "workflows.editor.errors.initial_state_required" }));
  expect(screen.getByRole("combobox", { name: "workflows.editor.start_panel.field" })).toBeTruthy();
});

describe("stale save", () => {
  it("asks to reload and blocks the save", async () => {
    const onReload = vi.fn(async () => {});
    renderEditor({ onSave: vi.fn().mockRejectedValue({ graph: ["stale_graph"] }), onReload });
    const user = userEvent.setup();
    await addReview(user);
    await user.click(screen.getByRole("button", { name: "workflows.editor.save" }));
    const banner = await screen.findByRole("alert");
    expect(within(banner).getByText("workflows.editor.errors.stale_graph")).toBeTruthy();
    expect((screen.getByRole("button", { name: "workflows.editor.save" }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(within(banner).getByRole("button", { name: "workflows.editor.reload" }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  // Spec 4.6: the save stays blocked until the workflow is reloaded, a discard does not reload it.
  it("keeps the save blocked after a discard", async () => {
    renderEditor({ onSave: vi.fn().mockRejectedValue({ graph: ["stale_graph"] }) });
    const user = userEvent.setup();
    await addReview(user);
    await user.click(screen.getByRole("button", { name: "workflows.editor.save" }));
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "workflows.editor.discard" }));
    await addReview(user);
    expect(within(screen.getByRole("alert")).getByText("workflows.editor.errors.stale_graph")).toBeTruthy();
    expect((screen.getByRole("button", { name: "workflows.editor.save" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("presence", () => {
  it("shows the other admins who are editing", async () => {
    const onPresence = vi.fn(async () => [{ id: "u", display_name: "Awa" }]);
    renderEditor({ onPresence });
    expect((await screen.findByRole("status")).textContent).toBe("workflows.editor.presence");
    expect(onPresence).toHaveBeenCalledWith(false);
  });

  it("signals its own unsaved changes, then their end when it closes", async () => {
    const onPresence = vi.fn(async () => []);
    const { unmount } = renderEditor({ onPresence });
    await addReview(userEvent.setup());
    await waitFor(() => expect(onPresence).toHaveBeenLastCalledWith(true));
    unmount();
    expect(onPresence).toHaveBeenLastCalledWith(false);
  });

  it("asks again every thirty seconds", async () => {
    vi.useFakeTimers();
    try {
      const onPresence = vi.fn(async () => []);
      renderEditor({ onPresence });
      expect(onPresence).toHaveBeenCalledTimes(1);
      await act(() => vi.advanceTimersByTimeAsync(30_000));
      expect(onPresence).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps its timer when the page hands over a new callback", async () => {
    vi.useFakeTimers();
    try {
      const first = vi.fn(async () => []);
      const second = vi.fn(async () => []);
      const view = renderEditor({ onPresence: first });
      await act(() => vi.advanceTimersByTimeAsync(10_000));
      view.rerender(editorOf({ onPresence: second }));
      expect(first).toHaveBeenCalledTimes(1);
      expect(second).not.toHaveBeenCalled();
      await act(() => vi.advanceTimersByTimeAsync(20_000));
      expect(second).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("signals the end of its changes when they are discarded", async () => {
    const onPresence = vi.fn(async () => []);
    renderEditor({ onPresence });
    const user = userEvent.setup();
    await addReview(user);
    await waitFor(() => expect(onPresence).toHaveBeenLastCalledWith(true));
    await user.click(screen.getByRole("button", { name: "workflows.editor.discard" }));
    await waitFor(() => expect(onPresence).toHaveBeenLastCalledWith(false));
  });

  it("hides the banner when the call fails", async () => {
    const onPresence = vi.fn().mockRejectedValue(new Error("down"));
    renderEditor({ onPresence });
    await waitFor(() => expect(onPresence).toHaveBeenCalled());
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("is silent for a reader", () => {
    const onPresence = vi.fn(async () => []);
    renderEditor({ readOnly: true, onPresence });
    expect(onPresence).not.toHaveBeenCalled();
  });
});

describe("renaming a shared state", () => {
  const shared = [
    {
      ...statusOf("sa", "Todo"),
      workflow_count: 2,
      workflows: [
        { id: "w", name: "Software" },
        { id: "w2", name: "Bug" },
      ],
    },
    statusOf("sb", "Done"),
  ];
  const rename = async (user: ReturnType<typeof userEvent.setup>) => {
    fireEvent.click(screen.getByText("Todo"));
    const field = screen.getByRole("textbox", { name: "workflows.editor.add_state.name" });
    await user.clear(field);
    await user.type(field, "To do");
    await user.click(screen.getByRole("button", { name: "workflows.editor.save" }));
  };

  it("asks before saving and sends nothing when cancelled", async () => {
    const onSave = vi.fn(async () => workflow);
    renderEditor({ statuses: shared, onSave });
    const user = userEvent.setup();
    await rename(user);
    expect(await screen.findByText("workflows.editor.rename.line")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "workflows.settings.form.cancel" }));
    expect(onSave).not.toHaveBeenCalled();
  });

  it("saves once the rename is confirmed", async () => {
    const onSave = vi.fn(async (_payload: TWorkflowGraphSavePayload) => workflow);
    renderEditor({ statuses: shared, onSave });
    const user = userEvent.setup();
    await rename(user);
    await user.click(await screen.findByRole("button", { name: "workflows.editor.rename.confirm" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0].states[0].status.name).toBe("To do");
  });

  it("does not ask for a state this workflow is alone to use", async () => {
    const onSave = vi.fn(async () => workflow);
    renderEditor({ onSave });
    await rename(userEvent.setup());
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  });
});

it("tells the page when unsaved changes appear and go", async () => {
  const onDirtyChange = vi.fn();
  renderEditor({ onDirtyChange });
  const user = userEvent.setup();
  await addReview(user);
  await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true));
  await user.click(screen.getByRole("button", { name: "workflows.editor.discard" }));
  await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
});

it("gives the focus back to the panel heading when the selection comes from the panel", async () => {
  renderEditor();
  const user = userEvent.setup();
  fireEvent.click(screen.getByText("Done"));
  // The card of the transition "Finish" arriving in "Done" is a button of the panel.
  await user.click(screen.getByRole("button", { name: /Finish/ }));
  const heading = screen.getByRole("heading", { level: 2 });
  await waitFor(() => expect(document.activeElement).toBe(heading));
});
