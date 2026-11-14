/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
const ANY = "workflows.editor.add_state.allow_any";
const K = "workflows.editor.add_state.";

// What a screen reader reads after the name of the control.
const describedBy = (element: HTMLElement) =>
  (element.getAttribute("aria-describedby") ?? "")
    .split(" ")
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent)
    .join(" | ");

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
        {
          id: "s1",
          name: "Todo",
          color: "#111111",
          group: "unstarted",
          known_group: "unstarted",
          group_locked: true,
          shared_count: 2,
        },
        {
          name: "Review",
          color: "#333333",
          group: "started",
          known_group: "started",
          group_locked: false,
          shared_count: 0,
        },
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
    await user.click(screen.getByRole("checkbox", { name: ANY }));
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

  it("creates the typed state on Enter without submitting the dialog", async () => {
    const { onAdd, user } = open();
    await user.click(screen.getByRole("checkbox", { name: /Todo/ }));
    await user.type(screen.getByRole("textbox", { name: NAME }), "Fresh{Enter}");
    expect(onAdd).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: ADD }));
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd.mock.calls[0][0].map((status: { name: string }) => status.name)).toEqual(["Todo", "Fresh"]);
  });

  it("keeps showing its list while it closes after an add", async () => {
    const view = render(<AddStatusDialog isOpen draft={draft} options={options} onClose={() => {}} onAdd={vi.fn()} />);
    await userEvent.setup().click(screen.getByRole("checkbox", { name: /Review/ }));
    // jsdom runs no animation: an endless one keeps the closing dialog on screen, as a browser does.
    const prototype = Element.prototype as unknown as { getAnimations?: () => unknown[] };
    prototype.getAnimations = () => [{ finished: new Promise(() => {}) }];
    try {
      // The editor closes the dialog in the same update that puts the ticked states in the draft.
      view.rerender(
        <AddStatusDialog
          isOpen={false}
          draft={draft}
          options={options.slice(0, 1)}
          onClose={() => {}}
          onAdd={vi.fn()}
        />
      );
      expect(screen.getByRole("checkbox", { name: /Review/, hidden: true })).toHaveProperty("checked", true);
      expect(screen.queryByText("workflows.editor.add_state.none")).toBeNull();
    } finally {
      delete prototype.getAnimations;
    }
  });

  it("ignores the Enter that commits an IME composition", async () => {
    const { user } = open();
    const field = screen.getByRole("textbox", { name: NAME });
    await user.type(field, "Fresh");
    fireEvent.keyDown(field, { key: "Enter", isComposing: true });
    expect(screen.getByRole("button", { name: CREATE })).toBeTruthy();
    expect((field as HTMLInputElement).value).toBe("Fresh");
  });

  it("does nothing on Enter when the typed name cannot be created", async () => {
    const { onAdd, user } = open();
    await user.click(screen.getByRole("checkbox", { name: /Todo/ }));
    await user.type(screen.getByRole("textbox", { name: NAME }), "used{Enter}");
    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe("workflows.editor.add_state.errors.present");
  });

  describe("the any-state option", () => {
    it("is set apart from the list under its own heading, with what it does and how to do the same for an existing state", () => {
      open();
      const option = screen.getByRole("group", { name: K + "any_title" });
      // X8: native elements, named by their legend.
      expect(option.tagName).toBe("FIELDSET");
      expect(option.querySelector(":scope > legend")?.textContent).toBe(K + "any_title");
      expect(option.contains(screen.getByRole("checkbox", { name: ANY }))).toBe(true);
      expect(option.textContent).toContain(K + "any_help");
      expect(option.textContent).toContain(K + "any_existing_hint");
      expect(screen.getByRole("list").contains(option)).toBe(false);
    });

    it("is disabled while no state is selected, and says why to assistive technology", async () => {
      const { user } = open();
      const box = screen.getByRole("checkbox", { name: ANY });
      expect(box).toHaveProperty("disabled", true);
      expect(describedBy(box)).toContain(K + "any_help");
      expect(describedBy(box)).toContain(K + "any_needs_selection");
      await user.click(screen.getByRole("checkbox", { name: /Todo/ }));
      expect(box).toHaveProperty("disabled", false);
      expect(describedBy(box)).toContain(K + "any_help");
      expect(describedBy(box)).not.toContain(K + "any_needs_selection");
    });

    it("becomes available as soon as a state is created", async () => {
      const { user } = open();
      await user.type(screen.getByRole("textbox", { name: NAME }), "Fresh{Enter}");
      expect(screen.getByRole("checkbox", { name: ANY })).toHaveProperty("disabled", false);
    });

    it("is unticked and disabled again when the selection becomes empty", async () => {
      const { onAdd, user } = open();
      const todo = screen.getByRole("checkbox", { name: /Todo/ });
      await user.click(todo);
      await user.click(screen.getByRole("checkbox", { name: ANY }));
      await user.click(todo);
      const box = screen.getByRole("checkbox", { name: ANY });
      expect(box).toHaveProperty("checked", false);
      expect(box).toHaveProperty("disabled", true);
      expect(screen.getByRole("button", { name: ADD })).toHaveProperty("disabled", true);
      await user.click(todo);
      expect(box).toHaveProperty("checked", false);
      await user.click(screen.getByRole("button", { name: ADD }));
      expect(onAdd.mock.calls[0][1]).toBe(false);
    });
  });

  describe("an empty list", () => {
    const openWith = (list: TStatusOption[]) => {
      render(<AddStatusDialog isOpen draft={draft} options={list} onClose={() => {}} onAdd={vi.fn()} />);
      return userEvent.setup();
    };

    it("tells that every available state is already in the workflow when nothing is searched", () => {
      openWith([]);
      expect(screen.getByText(K + "all_used")).toBeTruthy();
      expect(screen.queryByText(K + "none")).toBeNull();
    });

    it("keeps the no-match message for a search that matches nothing", async () => {
      const user = openWith(options);
      await user.type(screen.getByRole("textbox", { name: NAME }), "used");
      expect(screen.getByText(K + "none")).toBeTruthy();
      expect(screen.queryByText(K + "all_used")).toBeNull();
    });
  });
});
