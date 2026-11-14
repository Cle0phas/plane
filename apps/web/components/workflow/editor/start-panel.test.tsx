/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { TDraftGraph } from "./graph-model";
import { StartPanel } from "./start-panel";

vi.mock("@plane/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const state = (key: string, name: string, isInitial = false) => ({
  key,
  status: { name, color: "#3A3A3A", group: null, shared_count: 0 },
  position_x: 0,
  position_y: 0,
  is_initial: isInitial,
});
const linked: TDraftGraph = { states: [state("a", "Todo", true), state("b", "Done")], transitions: [] };
const unlinked: TDraftGraph = { states: [state("a", "Todo"), state("b", "Done")], transitions: [] };
const FIELD = "workflows.editor.start_panel.field";
const UNLINK = "workflows.editor.start_panel.unlink";
const REQUIRED = "workflows.editor.errors.initial_state_required";

describe("StartPanel", () => {
  it("shows the start state and moves the link to another one", async () => {
    const onChange = vi.fn();
    render(<StartPanel draft={linked} canEdit onChange={onChange} />);
    expect((screen.getByRole("combobox", { name: FIELD }) as HTMLSelectElement).value).toBe("a");
    await userEvent.setup().selectOptions(screen.getByRole("combobox", { name: FIELD }), "Done");
    expect(onChange.mock.calls[0][0].states.map((item: { is_initial: boolean }) => item.is_initial)).toEqual([
      false,
      true,
    ]);
  });

  it("removes the link", async () => {
    const onChange = vi.fn();
    render(<StartPanel draft={linked} canEdit onChange={onChange} />);
    await userEvent.setup().click(screen.getByRole("button", { name: UNLINK }));
    expect(onChange.mock.calls[0][0].states.some((item: { is_initial: boolean }) => item.is_initial)).toBe(false);
  });

  it("asks for a link when there is none, with nothing to remove", () => {
    render(<StartPanel draft={unlinked} canEdit onChange={() => {}} />);
    expect((screen.getByRole("combobox", { name: FIELD }) as HTMLSelectElement).value).toBe("");
    expect(screen.getByText(REQUIRED)).toBeTruthy();
    expect(screen.queryByRole("button", { name: UNLINK })).toBeNull();
  });

  it("offers no action to a reader", () => {
    render(<StartPanel draft={linked} canEdit={false} onChange={() => {}} />);
    expect((screen.getByRole("combobox", { name: FIELD }) as HTMLSelectElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: UNLINK })).toBeNull();
  });
});
