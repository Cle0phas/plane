/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { TDraftGraph } from "./graph-model";
import { WorkflowTextView } from "./text-view";

vi.mock("@plane/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const draft: TDraftGraph = {
  states: [
    {
      key: "a",
      status: { name: "Todo", color: "#3A3A3A", group: null },
      position_x: 0,
      position_y: 0,
      is_initial: true,
    },
    {
      key: "b",
      status: { name: "Done", color: "#3A3A3A", group: null },
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

// The state button of a row is named by its lozenge, the row is its closest <tr>.
const rowOf = (name: string) => screen.getByRole("button", { name }).closest("tr") as HTMLElement;
const show = (selection: Parameters<typeof WorkflowTextView>[0]["selection"] = null, onSelect = vi.fn()) => {
  render(<WorkflowTextView draft={draft} selection={selection} onSelect={onSelect} />);
  return onSelect;
};

describe("WorkflowTextView", () => {
  it("shows a transition in the row of its source and in the row of its target", () => {
    show();
    expect(within(rowOf("Todo")).getAllByText("Finish")).toHaveLength(1);
    expect(within(rowOf("Done")).getAllByText("Finish")).toHaveLength(1);
  });

  it("shows the start and a global transition only in the row of their target", () => {
    show();
    expect(within(rowOf("Todo")).getByText("workflows.editor.text.origin_start")).toBeTruthy();
    expect(within(rowOf("Todo")).getByText("workflows.editor.text.origin_any")).toBeTruthy();
    expect(within(rowOf("Done")).queryByText("workflows.editor.text.origin_start")).toBeNull();
    expect(within(rowOf("Done")).queryByText("workflows.editor.text.origin_any")).toBeNull();
  });

  it("opens the panel of a transition, of the start, or of a state", async () => {
    const onSelect = show();
    const user = userEvent.setup();
    await user.click(within(rowOf("Done")).getByRole("button", { name: /Finish/ }));
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "transition", key: "t" });
    await user.click(within(rowOf("Todo")).getByRole("button", { name: /origin_start/ }));
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "start" });
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "state", key: "b" });
    expect(onSelect).toHaveBeenCalledTimes(3);
  });

  it("marks every line of the selected transition as pressed", () => {
    show({ kind: "transition", key: "t" });
    expect(screen.getAllByRole("button", { name: /Finish/, pressed: true })).toHaveLength(2);
    expect(screen.getAllByRole("button", { pressed: true })).toHaveLength(2);
  });

  it("names a transition without a name", () => {
    show();
    // The start and the global transition of Todo both have no name.
    expect(within(rowOf("Todo")).getAllByRole("button", { name: /workflows\.editor\.text\.unnamed/ })).toHaveLength(2);
  });

  it("hides the transitions of a collapsed state", async () => {
    show();
    const toggle = within(rowOf("Done")).getByRole("button", { name: "workflows.editor.text.toggle" });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    await userEvent.setup().click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(within(rowOf("Done")).queryByText("Finish")).toBeNull();
  });

  it("selects the state when its row is clicked outside a button", async () => {
    const onSelect = show();
    const cells = within(rowOf("Done")).getAllByRole("cell");
    await userEvent.setup().click(cells[1]);
    expect(onSelect.mock.calls).toEqual([[{ kind: "state", key: "b" }]]);
  });

  it("marks the initial state and writes each category as text", () => {
    show();
    expect(within(rowOf("Todo")).getByText("workflows.editor.text.initial_state")).toBeTruthy();
    expect(within(rowOf("Done")).getByText("workflows.groups.completed")).toBeTruthy();
  });

  it("explains the icons below the table", () => {
    show();
    expect(screen.getByText("workflows.editor.text.legend_start")).toBeTruthy();
    expect(screen.getByText("workflows.editor.text.legend_any")).toBeTruthy();
  });

  it("says so when the workflow is empty", () => {
    render(<WorkflowTextView draft={{ states: [], transitions: [] }} selection={null} onSelect={() => {}} />);
    expect(screen.getByText("workflows.editor.text.empty")).toBeTruthy();
  });
});
