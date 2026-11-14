/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AddStatusDialog } from "./add-status-dialog";
import type { TDraftGraph, TStatusOption } from "./graph-model";

// The key stands for the text; a new t on every render mirrors the real hook.
vi.mock("@plane/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const options: TStatusOption[] = [
  { id: "s1", name: "Todo", color: "#111111", group: "unstarted", group_is_auto: false, workflow_count: 2 },
  { name: "Review", color: "#333333", group: "started", group_is_auto: false, workflow_count: 0 },
  { name: "Done", color: "#444444", group: "completed", group_is_auto: false, workflow_count: 0 },
];
const draft: TDraftGraph = {
  states: [
    {
      key: "u",
      status: { name: "Used", color: "#3A3A3A", group: null, shared_count: 0 },
      position_x: 0,
      position_y: 0,
      is_initial: true,
    },
  ],
  transitions: [],
};
const ADD = "workflows.editor.add_state.submit";
const NAME = "workflows.editor.add_state.name";
const CREATE = "workflows.editor.add_state.create_option";

const open = (onAdd = vi.fn()) => {
  render(<AddStatusDialog isOpen draft={draft} options={options} onClose={() => {}} onAdd={onAdd} />);
  return { onAdd, user: userEvent.setup() };
};

describe("AddStatusDialog", () => {
  it("adds every ticked state in one go", async () => {
    const { onAdd, user } = open();
    await user.click(screen.getByRole("checkbox", { name: /Todo/ }));
    await user.click(screen.getByRole("checkbox", { name: /Review/ }));
    await user.click(screen.getByRole("button", { name: ADD }));
    expect(onAdd).toHaveBeenCalledWith(
      [
        { id: "s1", name: "Todo", color: "#111111", group: "unstarted", known_group: "unstarted", shared_count: 2 },
        { name: "Review", color: "#333333", group: "started", known_group: "started", shared_count: 0 },
      ],
      false
    );
  });

  it("keeps the add button disabled until a state is picked", async () => {
    const { user } = open();
    expect(screen.getByRole("button", { name: ADD })).toHaveProperty("disabled", true);
    await user.click(screen.getByRole("checkbox", { name: /Done/ }));
    expect(screen.getByRole("button", { name: ADD })).toHaveProperty("disabled", false);
  });

  it("filters the list and creates a state from the typed name", async () => {
    const { onAdd, user } = open();
    await user.type(screen.getByRole("textbox", { name: NAME }), "Fresh");
    expect(screen.queryByRole("checkbox", { name: /Todo/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: CREATE }));
    await user.click(screen.getByRole("checkbox", { name: "workflows.editor.add_state.allow_any" }));
    await user.click(screen.getByRole("button", { name: ADD }));
    expect(onAdd).toHaveBeenCalledWith([{ name: "Fresh", color: "#3A3A3A", group: null, shared_count: 0 }], true);
  });

  it("refuses a name the workflow already has", async () => {
    const { user } = open();
    await user.type(screen.getByRole("textbox", { name: NAME }), "used");
    expect(screen.queryByRole("button", { name: CREATE })).toBeNull();
    expect(screen.getByRole("alert").textContent).toBe("workflows.editor.add_state.errors.present");
  });

  it("refuses a name longer than 255 characters", async () => {
    const { user } = open();
    await user.click(screen.getByRole("textbox", { name: NAME }));
    await user.paste("a".repeat(256));
    expect(screen.queryByRole("button", { name: CREATE })).toBeNull();
    expect(screen.getByRole("alert").textContent).toBe("workflows.editor.add_state.errors.too_long");
  });

  it("shows no error on an empty field, and requires a name when only spaces are typed", async () => {
    const { user } = open();
    expect(screen.queryByRole("alert")).toBeNull();
    await user.type(screen.getByRole("textbox", { name: NAME }), "   ");
    expect(screen.queryByRole("button", { name: CREATE })).toBeNull();
    expect(screen.getByRole("alert").textContent).toBe("workflows.editor.add_state.errors.required");
  });

  it("moves the focus into the dialog when it opens (spec 3.9, handled by the propel dialog)", async () => {
    open();
    await waitFor(() => expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true));
  });
});
