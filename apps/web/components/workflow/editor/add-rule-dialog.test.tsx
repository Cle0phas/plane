/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AddRuleDialog } from "./add-rule-dialog";
import type { TDraftGraph, TDraftTransition } from "./graph-model";

vi.mock("@plane/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/hooks/store/use-member", () => ({
  useMember: () => ({ workspace: { workspaceMemberIds: [], getWorkspaceMemberDetails: () => undefined } }),
}));

const state = (key: string, name: string, isInitial = false) => ({
  key,
  status: { name, color: "#3A3A3A", group: null, shared_count: 0 },
  position_x: 0,
  position_y: 0,
  is_initial: isInitial,
});
const transition = (key: string, source: string, target: string, roles?: number[]): TDraftTransition => ({
  key,
  name: key,
  from_any: false,
  source_keys: [source],
  target_key: target,
  rules: roles ? [{ type: "restrict_actors", params: { roles } }] : [],
});
const draft: TDraftGraph = {
  states: [state("a", "Alpha", true), state("b", "Beta"), state("c", "Gamma")],
  transitions: [transition("t1", "a", "b"), transition("t2", "b", "c", [20])],
};
const APPLY = "workflows.editor.add_rule.submit";
const PICKER = "workflows.editor.add_rule.transition";
const ADMIN = "workflows.roles.admin";

const open = (presetKey: string | null = null, graph = draft) => {
  const onApply = vi.fn();
  render(<AddRuleDialog isOpen draft={graph} presetKey={presetKey} onClose={() => {}} onApply={onApply} />);
  return { onApply, user: userEvent.setup() };
};
const picker = () => screen.getByRole("combobox", { name: PICKER }) as HTMLSelectElement;
const isChecked = (name: string) => (screen.getByRole("checkbox", { name }) as HTMLInputElement).checked;

describe("AddRuleDialog", () => {
  it("preselects the preset transition", async () => {
    open("t2");
    await waitFor(() => expect(picker().value).toBe("t2"));
    expect(isChecked(ADMIN)).toBe(true);
  });

  it("falls back to the first transition when the preset is unknown", async () => {
    open("missing");
    await waitFor(() => expect(picker().value).toBe("t1"));
    expect(screen.getByRole("button", { name: APPLY })).toHaveProperty("disabled", false);
  });

  it("loads the rule of the transition that gets picked", async () => {
    const { user } = open("t1");
    await waitFor(() => expect(picker().value).toBe("t1"));
    expect(isChecked(ADMIN)).toBe(false);
    await user.selectOptions(picker(), "t2");
    await waitFor(() => expect(isChecked(ADMIN)).toBe(true));
    await user.selectOptions(picker(), "t1");
    await waitFor(() => expect(isChecked(ADMIN)).toBe(false));
  });

  it("applies the transition key and the restriction", async () => {
    const { onApply, user } = open("t1");
    await waitFor(() => expect(picker().value).toBe("t1"));
    await user.click(screen.getByRole("checkbox", { name: ADMIN }));
    await user.click(screen.getByRole("button", { name: APPLY }));
    expect(onApply).toHaveBeenCalledWith("t1", { roles: [20] });
  });

  it("refuses an empty restriction but lets the restriction be removed", async () => {
    const { onApply, user } = open("t2");
    await waitFor(() => expect(isChecked(ADMIN)).toBe(true));
    await user.click(screen.getByRole("checkbox", { name: ADMIN }));
    expect(screen.getByRole("button", { name: APPLY })).toHaveProperty("disabled", true);
    await user.click(screen.getByRole("button", { name: "workflows.editor.restrict.clear" }));
    await user.click(screen.getByRole("button", { name: APPLY }));
    expect(onApply).toHaveBeenCalledWith("t2", null);
  });

  it("explains that a transition is needed first", () => {
    open(null, { ...draft, transitions: [] });
    expect(screen.getByText("workflows.editor.add_rule.none")).toBeTruthy();
    expect(screen.getByRole("button", { name: APPLY })).toHaveProperty("disabled", true);
  });
});
