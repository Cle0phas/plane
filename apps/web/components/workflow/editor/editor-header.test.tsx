/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EditorHeader } from "./editor-header";

vi.mock("@plane/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const props = (extra = {}) => ({
  name: "Support",
  description: "Tickets of the help desk",
  projectCount: 1,
  canEdit: true,
  dirty: false,
  canSave: false,
  isSaving: false,
  onAddState: vi.fn(),
  onAddTransition: vi.fn(),
  onAddRule: vi.fn(),
  onSave: vi.fn(),
  onDiscard: vi.fn(),
  onClose: vi.fn(),
  ...extra,
});

describe("EditorHeader", () => {
  it("leads back to the list through the breadcrumb, with the same guard as Close", async () => {
    const onClose = vi.fn();
    render(<EditorHeader {...props({ onClose })} />);
    const nav = screen.getByRole("navigation", { name: "workflows.editor.breadcrumb" });
    await userEvent.setup().click(within(nav).getByRole("button", { name: "workflows.label" }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(within(nav).getByText("Support").getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("heading", { level: 1, name: "Support" })).toBeTruthy();
  });

  it("shows the description in full on hover and nothing when there is none", () => {
    const { rerender } = render(<EditorHeader {...props()} />);
    expect(screen.getByText("Tickets of the help desk").getAttribute("title")).toBe("Tickets of the help desk");
    rerender(<EditorHeader {...props({ description: "" })} />);
    expect(screen.queryByText("Tickets of the help desk")).toBeNull();
  });
});
