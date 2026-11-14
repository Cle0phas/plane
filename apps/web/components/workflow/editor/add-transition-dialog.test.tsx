/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AddTransitionDialog } from "./add-transition-dialog";
import type { TDraftGraph } from "./graph-model";

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
  transitions: [],
};
const SUBMIT = "workflows.editor.add_transition.submit";
const ANY = "workflows.editor.add_transition.any_state";
const TARGET = "workflows.editor.add_transition.target";

const open = (preset: { sourceKey?: string; targetKey?: string } | null = null) => {
  const onAdd = vi.fn();
  render(<AddTransitionDialog isOpen draft={draft} preset={preset} onClose={() => {}} onAdd={onAdd} />);
  return { onAdd, user: userEvent.setup() };
};

describe("AddTransitionDialog", () => {
  it("applies the preset source and target", async () => {
    const { onAdd, user } = open({ sourceKey: "a", targetKey: "b" });
    expect((screen.getByRole("checkbox", { name: "Alpha" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("combobox", { name: TARGET }) as HTMLSelectElement).value).toBe("b");
    await user.click(screen.getByRole("button", { name: SUBMIT }));
    expect(onAdd).toHaveBeenCalledWith({
      name: "",
      from_any: false,
      source_keys: ["a"],
      target_key: "b",
      rules: [],
      sides: {},
    });
  });

  it("removes a state from the sources when it becomes the target", async () => {
    const { onAdd, user } = open({ sourceKey: "a" });
    await user.click(screen.getByRole("checkbox", { name: "Beta" }));
    await user.selectOptions(screen.getByRole("combobox", { name: TARGET }), "a");
    expect((screen.getByRole("checkbox", { name: "Alpha" }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("checkbox", { name: "Alpha" }) as HTMLInputElement).disabled).toBe(true);
    await user.click(screen.getByRole("button", { name: SUBMIT }));
    expect(onAdd.mock.calls[0][0].source_keys).toEqual(["b"]);
  });

  it("sends no source keys for any state", async () => {
    const { onAdd, user } = open({ sourceKey: "a" });
    await user.click(screen.getByRole("checkbox", { name: ANY }));
    await user.selectOptions(screen.getByRole("combobox", { name: TARGET }), "c");
    await user.type(screen.getByRole("textbox"), " Reopen ");
    await user.click(screen.getByRole("button", { name: SUBMIT }));
    expect(onAdd).toHaveBeenCalledWith({
      name: "Reopen",
      from_any: true,
      source_keys: [],
      target_key: "c",
      rules: [],
      sides: {},
    });
  });

  it("keeps submit disabled until a source and a target are chosen", async () => {
    const { user } = open();
    const submit = screen.getByRole("button", { name: SUBMIT });
    expect(submit).toHaveProperty("disabled", true);
    await user.selectOptions(screen.getByRole("combobox", { name: TARGET }), "b");
    expect(submit).toHaveProperty("disabled", true);
    await user.click(screen.getByRole("checkbox", { name: "Alpha" }));
    expect(submit).toHaveProperty("disabled", false);
  });
});
