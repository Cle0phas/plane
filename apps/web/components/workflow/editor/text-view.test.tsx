/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { TDraftGraph } from "./graph-model";
import { WorkflowTextView } from "./text-view";

vi.mock("@plane/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const draft: TDraftGraph = {
  states: [
    {
      key: "a",
      status: { name: "Todo", color: "#3A3A3A", group: null, shared_count: 0 },
      position_x: 0,
      position_y: 0,
      is_initial: true,
    },
    {
      key: "b",
      status: { name: "Done", color: "#3A3A3A", group: null, shared_count: 0 },
      position_x: 240,
      position_y: 0,
      is_initial: false,
    },
  ],
  transitions: [
    { key: "t", name: "Finish", from_any: false, source_keys: ["a"], target_key: "b", rules: [] },
    { key: "g", name: "", from_any: true, source_keys: [], target_key: "a", rules: [] },
  ],
};

describe("WorkflowTextView", () => {
  it("lists every state with the transitions that lead to it", () => {
    render(<WorkflowTextView draft={draft} selection={null} onSelect={() => {}} />);
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("Todo");
    expect(rows[0].textContent).toContain("workflows.editor.text.origin_start");
    expect(rows[0].textContent).toContain("workflows.editor.text.origin_any");
    expect(rows[1].textContent).toContain("Finish");
    expect(rows[1].textContent).toContain("Todo → Done");
  });

  it("selects a state or a transition", async () => {
    const onSelect = vi.fn();
    render(<WorkflowTextView draft={draft} selection={null} onSelect={onSelect} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "state", key: "b" });
    await user.click(screen.getByRole("button", { name: /Finish/ }));
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "transition", key: "t" });
  });

  it("hides the transitions of a collapsed state", async () => {
    render(<WorkflowTextView draft={draft} selection={null} onSelect={() => {}} />);
    const toggles = screen.getAllByRole("button", { name: "workflows.editor.text.toggle" });
    await userEvent.setup().click(toggles[1]);
    expect(toggles[1].getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: /Finish/ })).toBeNull();
  });

  it("says so when the workflow is empty", () => {
    render(<WorkflowTextView draft={{ states: [], transitions: [] }} selection={null} onSelect={() => {}} />);
    expect(screen.getByText("workflows.editor.text.empty")).toBeTruthy();
  });

  it("gives a transition without a name a readable, selectable label", async () => {
    const onSelect = vi.fn();
    render(<WorkflowTextView draft={draft} selection={null} onSelect={onSelect} />);
    const button = screen.getByRole("button", {
      name: "workflows.editor.text.unnamed (workflows.editor.text.origin_any → Todo)",
    });
    await userEvent.setup().click(button);
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "transition", key: "g" });
  });

  it("keeps list keys unique when one transition has several sources", () => {
    const multi: TDraftGraph = {
      states: [
        ...draft.states,
        {
          key: "c",
          status: { name: "Review", color: "#3A3A3A", group: "started", shared_count: 0 },
          position_x: 480,
          position_y: 0,
          is_initial: false,
        },
      ],
      transitions: [{ key: "m", name: "Go", from_any: false, source_keys: ["a", "b"], target_key: "c", rules: [] }],
    };
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<WorkflowTextView draft={multi} selection={null} onSelect={() => {}} />);
    expect(screen.getAllByRole("button", { name: /Go/ })).toHaveLength(2);
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it("writes the category as text next to the coloured state", () => {
    const started: TDraftGraph = {
      states: [{ ...draft.states[0], status: { ...draft.states[0].status, group: "started" } }],
      transitions: [],
    };
    render(<WorkflowTextView draft={started} selection={null} onSelect={() => {}} />);
    expect(screen.getByText("workflows.groups.started")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Todo" }).className).toContain("bg-info-subtle");
  });
});
