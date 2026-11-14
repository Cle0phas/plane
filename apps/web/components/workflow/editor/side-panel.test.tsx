/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { ComponentProps } from "react";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TDraftGraph, TDraftStatus } from "./graph-model";
import { WorkflowSidePanel } from "./side-panel";

vi.mock("@plane/i18n", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key),
  }),
}));
// The rule form reads the member store; it is out of scope here.
vi.mock("./restrict-actors-form", () => ({ RestrictActorsForm: () => null }));

const AUTO = "workflows.editor.add_state.group_auto";

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
      onAddTransition={() => {}}
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
});
