/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { ComponentProps } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { TDraftGraph, TDraftStatus } from "./graph-model";
import { WorkflowSidePanel } from "./side-panel";

vi.mock("@plane/i18n", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key),
    // Lists of names are formatted for the language.
    currentLocale: "en",
  }),
}));

const AUTO = "workflows.editor.add_state.group_auto";
const removeLabel = (name: string) => `workflows.editor.panel.remove_source {"name":"${name}"}`;

const state = (key: string, status: Partial<TDraftStatus> = {}) => ({
  key,
  status: { name: key.toUpperCase(), color: "#3A3A3A", group: null, shared_count: 0, ...status },
  position_x: 0,
  position_y: 0,
  is_initial: false,
});

const renderPanel = (props: Partial<ComponentProps<typeof WorkflowSidePanel>>) =>
  render(
    <WorkflowSidePanel
      draft={{ states: [], transitions: [] }}
      selection={null}
      canEdit
      onChange={() => {}}
      onSelect={() => {}}
      onAddTransition={() => {}}
      onEditRule={() => {}}
      focusSignal={0}
      {...props}
    />
  );

const categoryOptions = () =>
  within(screen.getByRole("combobox", { name: "workflows.editor.add_state.group" }))
    .getAllByRole("option")
    .map((option) => option.textContent);

describe("WorkflowSidePanel", () => {
  // The server ignores a return to automatic for a category chosen by hand (W5).
  it("offers no automatic category for a status set by hand on the server", () => {
    const draft: TDraftGraph = {
      states: [state("a", { id: "sa", group: "started", known_group: "started", group_locked: true })],
      transitions: [],
    };
    renderPanel({ draft, selection: { kind: "state", key: "a" } });
    expect(categoryOptions()).not.toContain(AUTO);
    expect(categoryOptions()).toContain("workflows.groups.started");
  });

  it("offers the automatic category for a new status and for one automatic on the server", () => {
    const draft: TDraftGraph = {
      states: [state("new"), state("auto", { id: "sb", known_group: "completed", group_locked: false })],
      transitions: [],
    };
    const view = renderPanel({ draft, selection: { kind: "state", key: "new" } });
    expect(categoryOptions()).toContain(AUTO);
    view.unmount();
    renderPanel({ draft, selection: { kind: "state", key: "auto" } });
    expect(categoryOptions()).toContain(AUTO);
  });

  // The server bound (255): longer names were refused with the generic error only.
  it("caps the state name and the transition name at 255 characters", () => {
    const draft: TDraftGraph = {
      states: [state("a"), state("b")],
      transitions: [{ key: "t", name: "", from_any: false, source_keys: ["a"], target_key: "b", rules: [] }],
    };
    const view = renderPanel({ draft, selection: { kind: "state", key: "a" } });
    expect(screen.getByRole("textbox", { name: "workflows.editor.add_state.name" }).getAttribute("maxlength")).toBe(
      "255"
    );
    view.unmount();
    renderPanel({ draft, selection: { kind: "transition", key: "t" } });
    expect(
      screen.getByRole("textbox", { name: "workflows.editor.add_transition.name" }).getAttribute("maxlength")
    ).toBe("255");
  });

  describe("sources of a transition", () => {
    const draft: TDraftGraph = {
      states: [state("a"), state("b"), state("c")],
      transitions: [
        {
          key: "t",
          name: "Finish",
          from_any: false,
          source_keys: ["a", "b"],
          target_key: "c",
          rules: [],
          sides: { a: { source: "right", target: "left" } },
        },
        { key: "u", name: "", from_any: false, source_keys: ["a"], target_key: "b", rules: [] },
      ],
    };

    it("removes one source of a transition that has several", async () => {
      const onChange = vi.fn();
      renderPanel({ draft, selection: { kind: "transition", key: "t" }, onChange });
      expect(screen.getByRole("button", { name: removeLabel("B") })).toBeTruthy();
      await userEvent.setup().click(screen.getByRole("button", { name: removeLabel("A") }));
      const next = onChange.mock.calls[0][0] as TDraftGraph;
      expect(next.transitions[0]).toMatchObject({ key: "t", name: "Finish", source_keys: ["b"], sides: {} });
    });

    it("offers no removal of the only source, nor in read-only mode", () => {
      const view = renderPanel({ draft, selection: { kind: "transition", key: "u" } });
      expect(screen.queryByRole("button", { name: removeLabel("A") })).toBeNull();
      view.unmount();
      renderPanel({ draft, selection: { kind: "transition", key: "t" }, canEdit: false });
      expect(screen.queryByRole("button", { name: removeLabel("A") })).toBeNull();
    });
  });
});

const transition = (key: string, sources: string[] | "*", target: string, name = "") => ({
  key,
  name,
  from_any: sources === "*",
  source_keys: sources === "*" ? [] : sources,
  target_key: target,
  rules: [],
  sides: {},
});
const three: TDraftGraph = {
  states: [state("a"), state("b"), state("c")],
  transitions: [transition("t1", ["a"], "b", "Start"), transition("g", "*", "b"), transition("t2", ["b"], "c")],
};

describe("state panel", () => {
  it("lists the incoming and outgoing transitions as cards that select them", async () => {
    const onSelect = vi.fn();
    renderPanel({ draft: three, selection: { kind: "state", key: "b" }, onSelect });
    expect(screen.getByRole("heading", { name: 'workflows.editor.panel.incoming_count {"count":2}' })).toBeTruthy();
    expect(screen.getByRole("heading", { name: 'workflows.editor.panel.outgoing_count {"count":1}' })).toBeTruthy();
    await userEvent.setup().click(screen.getByRole("button", { name: /Start.*A → B/ }));
    expect(onSelect).toHaveBeenCalledWith({ kind: "transition", key: "t1" });
    expect(screen.getByRole("button", { name: /workflows\.editor\.global → B/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /B → C/ })).toBeTruthy();
  });

  it("adds a transition locked on the state", async () => {
    const onAddTransition = vi.fn();
    renderPanel({ draft: three, selection: { kind: "state", key: "b" }, onAddTransition });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "workflows.editor.panel.add_incoming" }));
    await user.click(screen.getByRole("button", { name: "workflows.editor.panel.add_outgoing" }));
    expect(onAddTransition.mock.calls).toEqual([[{ side: "target", key: "b" }], [{ side: "source", key: "b" }]]);
  });

  it("names the other workflows that use the state", () => {
    const draft: TDraftGraph = {
      states: [state("a", { shared_count: 2, shared_names: ["Bug", "Delivery"] })],
      transitions: [],
    };
    renderPanel({ draft, selection: { kind: "state", key: "a" } });
    expect(screen.getByRole("note").textContent).toBe(
      'workflows.editor.panel.shared_named {"count":2,"names":"Bug, Delivery"}'
    );
  });

  it("shows no sharing note for a state used by this workflow only", () => {
    renderPanel({ draft: three, selection: { kind: "state", key: "a" } });
    expect(screen.queryByRole("note")).toBeNull();
  });
});

describe("transition panel", () => {
  it("adds one more source state from the states that do not duplicate a route", async () => {
    const onChange = vi.fn();
    renderPanel({ draft: three, selection: { kind: "transition", key: "t2" }, onChange });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "workflows.editor.panel.add_source" }));
    const picker = screen.getByRole("combobox", { name: "workflows.editor.panel.add_source" });
    expect(
      within(picker)
        .getAllByRole("option")
        .map((item) => item.textContent)
    ).toEqual(["workflows.editor.add_transition.choose_state", "A"]);
    await user.selectOptions(picker, "A");
    expect(onChange.mock.calls[0][0].transitions[2].source_keys).toEqual(["b", "a"]);
  });

  it("offers no source to add to a transition from any state", () => {
    renderPanel({ draft: three, selection: { kind: "transition", key: "g" } });
    expect(screen.queryByRole("button", { name: "workflows.editor.panel.add_source" })).toBeNull();
  });

  it("summarises the rule and lets it be edited or removed", async () => {
    const onChange = vi.fn();
    const onEditRule = vi.fn();
    const draft: TDraftGraph = {
      ...three,
      transitions: [
        {
          ...transition("t1", ["a"], "b"),
          rules: [{ type: "restrict_actors", params: { roles: [20, 15], user_ids: ["u1"], assignee: true } }],
        },
      ],
    };
    renderPanel({ draft, selection: { kind: "transition", key: "t1" }, onChange, onEditRule });
    expect(
      screen.getByText(
        'workflows.editor.restrict.summary_roles {"roles":"workflows.roles.admin, workflows.roles.member"} · workflows.editor.restrict.summary_users {"count":1} · workflows.editor.restrict.assignee'
      )
    ).toBeTruthy();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "workflows.editor.panel.edit_rule" }));
    expect(onEditRule).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "workflows.editor.panel.remove_rule" }));
    expect(onChange.mock.calls[0][0].transitions[0].rules).toEqual([]);
  });

  it("offers to add a rule when there is none", async () => {
    const onEditRule = vi.fn();
    renderPanel({ draft: three, selection: { kind: "transition", key: "t1" }, onEditRule });
    await userEvent.setup().click(screen.getByRole("button", { name: "workflows.editor.add_rule.title" }));
    expect(onEditRule).toHaveBeenCalledTimes(1);
  });
});

describe("read-only panel", () => {
  const actions = () =>
    screen
      .queryAllByRole("button")
      .map((button) => button.getAttribute("aria-label") ?? button.textContent)
      .filter((name) => name !== "workflows.editor.panel.collapse");

  it("offers no action on a state", () => {
    renderPanel({ draft: three, selection: { kind: "state", key: "b" }, canEdit: false });
    // The transition cards still select: reading is allowed.
    expect(actions().every((name) => /→/.test(name ?? ""))).toBe(true);
    // A disabled fieldset does not set the `disabled` property of its fields.
    expect(screen.getByRole("textbox", { name: "workflows.editor.add_state.name" }).matches(":disabled")).toBe(true);
  });

  it("offers no action on a transition", () => {
    renderPanel({ draft: three, selection: { kind: "transition", key: "t1" }, canEdit: false });
    expect(actions()).toEqual([]);
  });
});
