/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AddTransitionDialog, type TTransitionLock } from "./add-transition-dialog";
import type { TDraftGraph, TStatusOption } from "./graph-model";

vi.mock("@plane/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const state = (key: string, name: string, isInitial = false) => ({
  key,
  status: { name, color: "#3A3A3A", group: null, shared_count: 0 },
  position_x: 0,
  position_y: 0,
  is_initial: isInitial,
});
const draft: TDraftGraph = {
  states: [state("a", "Alpha", true), state("b", "Beta"), state("c", "Gamma")],
  transitions: [{ key: "t1", name: "", from_any: false, source_keys: ["a"], target_key: "b", rules: [], sides: {} }],
};
const option = (name: string, id?: string): TStatusOption => ({
  ...(id ? { id } : {}),
  name,
  color: "#333333",
  group: "started",
  group_is_auto: false,
  workflow_count: 0,
  workflow_names: [],
});
const options = [option("Review", "s9"), option("Shipped")];

const PREFIX = "workflows.editor.add_transition";
const SUBMIT = `${PREFIX}.submit`;
const ANY = `${PREFIX}.any_state`;
const SOURCES = `${PREFIX}.sources`;
const TARGET = `${PREFIX}.target`;
const IN_WORKFLOW = `${PREFIX}.in_workflow`;
const OTHERS = `${PREFIX}.other_states`;

// An optgroup also has the group role: the fieldset is the one that holds the checkboxes.
const fieldsetOf = (name: string) =>
  screen.getAllByRole("group", { name }).find((element) => element.tagName === "FIELDSET") as HTMLElement;
const checkboxNames = (name: string) =>
  within(fieldsetOf(name))
    .getAllByRole("checkbox")
    .map((box) => box.closest("label")?.textContent);
const submit = () => screen.getByRole("button", { name: SUBMIT }) as HTMLButtonElement;

const open = (lock: TTransitionLock | null = null) => {
  const onAdd = vi.fn();
  render(<AddTransitionDialog isOpen draft={draft} options={options} lock={lock} onClose={() => {}} onAdd={onAdd} />);
  return { onAdd, user: userEvent.setup() };
};

describe("AddTransitionDialog", () => {
  it("offers the states of the workflow, then the other existing states", () => {
    open();
    expect(checkboxNames(IN_WORKFLOW)).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(checkboxNames(OTHERS)).toEqual(["Review", "Shipped"]);
    const target = screen.getByRole("combobox", { name: TARGET });
    expect(
      within(target)
        .getAllByRole("option")
        .map((item) => item.textContent)
    ).toEqual([`${PREFIX}.choose_state`, "Alpha", "Beta", "Gamma", "Review", "Shipped"]);
  });

  it("opens empty from the header", () => {
    open();
    expect(screen.getAllByRole("checkbox").every((box) => !(box as HTMLInputElement).checked)).toBe(true);
    expect((screen.getByRole("combobox", { name: TARGET }) as HTMLSelectElement).value).toBe("");
    expect(submit().disabled).toBe(true);
  });

  it("returns states of both groups", async () => {
    const { onAdd, user } = open();
    await user.click(screen.getByRole("checkbox", { name: "Alpha" }));
    await user.click(screen.getByRole("checkbox", { name: "Review" }));
    await user.selectOptions(screen.getByRole("combobox", { name: TARGET }), "Shipped");
    await user.click(submit());
    expect(onAdd).toHaveBeenCalledWith({
      name: "",
      from_any: false,
      sources: [
        { kind: "state", key: "a" },
        { kind: "option", option: options[0] },
      ],
      target: { kind: "option", option: options[1] },
    });
  });

  it("locks the target when it is opened for an incoming transition", async () => {
    const { onAdd, user } = open({ side: "target", key: "b" });
    expect(screen.queryByRole("combobox", { name: TARGET })).toBeNull();
    const locked = screen.getByRole("textbox", { name: TARGET }) as HTMLInputElement;
    expect(locked.value).toBe("Beta");
    expect(locked.disabled).toBe(true);
    expect(screen.getByText(`${PREFIX}.locked`)).toBeTruthy();
    await user.click(screen.getByRole("checkbox", { name: "Gamma" }));
    await user.click(submit());
    expect(onAdd.mock.calls[0][0]).toMatchObject({
      sources: [{ kind: "state", key: "c" }],
      target: { kind: "state", key: "b" },
    });
  });

  it("locks the source when it is opened for an outgoing transition", async () => {
    const { onAdd, user } = open({ side: "source", key: "a" });
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect((screen.getByRole("textbox", { name: SOURCES }) as HTMLInputElement).value).toBe("Alpha");
    await user.selectOptions(screen.getByRole("combobox", { name: TARGET }), "Gamma");
    await user.click(submit());
    expect(onAdd.mock.calls[0][0]).toMatchObject({
      from_any: false,
      sources: [{ kind: "state", key: "a" }],
      target: { kind: "state", key: "c" },
    });
  });

  it("refuses a transition that already exists", async () => {
    const { user } = open();
    await user.click(screen.getByRole("checkbox", { name: "Alpha" }));
    await user.selectOptions(screen.getByRole("combobox", { name: TARGET }), "Beta");
    expect(screen.getByRole("alert").textContent).toBe(`${PREFIX}.duplicate`);
    expect(submit().disabled).toBe(true);
  });

  it("removes a state from the sources when it becomes the target", async () => {
    const { onAdd, user } = open();
    await user.click(screen.getByRole("checkbox", { name: "Alpha" }));
    await user.click(screen.getByRole("checkbox", { name: "Gamma" }));
    await user.selectOptions(screen.getByRole("combobox", { name: TARGET }), "Alpha");
    expect((screen.getByRole("checkbox", { name: "Alpha" }) as HTMLInputElement).disabled).toBe(true);
    await user.click(submit());
    expect(onAdd.mock.calls[0][0].sources).toEqual([{ kind: "state", key: "c" }]);
  });

  it("ignores the checked sources of a transition from any state", async () => {
    const { onAdd, user } = open();
    await user.click(screen.getByRole("checkbox", { name: "Alpha" }));
    await user.click(screen.getByRole("checkbox", { name: ANY }));
    await user.selectOptions(screen.getByRole("combobox", { name: TARGET }), "Gamma");
    await user.click(submit());
    expect(onAdd.mock.calls[0][0]).toMatchObject({ from_any: true, sources: [] });
  });
});
