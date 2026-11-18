/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StateLozenge } from "./state-lozenge";

vi.mock("@plane/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

describe("StateLozenge", () => {
  it("shows the name and names its category for those who cannot tell the colours apart", () => {
    render(<StateLozenge name="In review" group="started" />);
    const lozenge = screen.getByText("In review");
    expect(lozenge.getAttribute("title")).toBe("workflows.groups.started");
    expect(lozenge.className).toContain("uppercase");
  });

  it("marks the backlog with a dashed border, unlike a state not started", () => {
    render(
      <>
        <StateLozenge name="Backlog" group="backlog" />
        <StateLozenge name="Todo" group="unstarted" />
      </>
    );
    expect(screen.getByText("Backlog").className).toContain("border-dashed");
    expect(screen.getByText("Todo").className).not.toContain("border-dashed");
  });
});
