/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, Link, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { LeaveGuard } from "./leave-guard";

vi.mock("@plane/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const open = (when: boolean) => {
  const router = createMemoryRouter([
    {
      path: "/",
      element: (
        <>
          <LeaveGuard when={when} />
          <Link to="/other">go elsewhere</Link>
        </>
      ),
    },
    { path: "/other", element: <p>other page</p> },
  ]);
  render(<RouterProvider router={router} />);
  return userEvent.setup();
};
const fire = () => {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
};
const TITLE = "workflows.editor.leave.title";

describe("LeaveGuard", () => {
  it("lets a navigation through when there is nothing to lose", async () => {
    const user = open(false);
    await user.click(screen.getByRole("link", { name: "go elsewhere" }));
    expect(await screen.findByText("other page")).toBeTruthy();
  });

  it("asks before leaving and stays on request", async () => {
    const user = open(true);
    await user.click(screen.getByRole("link", { name: "go elsewhere" }));
    expect(await screen.findByText(TITLE)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "workflows.editor.leave.stay" }));
    await waitFor(() => expect(screen.queryByText(TITLE)).toBeNull());
    expect(screen.queryByText("other page")).toBeNull();
    expect(screen.getByRole("link", { name: "go elsewhere" })).toBeTruthy();
  });

  it("leaves once confirmed", async () => {
    const user = open(true);
    await user.click(screen.getByRole("link", { name: "go elsewhere" }));
    await user.click(await screen.findByRole("button", { name: "workflows.editor.leave.confirm" }));
    expect(await screen.findByText("other page")).toBeTruthy();
  });

  it("warns the browser on tab close only while there is something to lose", () => {
    const { unmount } = render(
      <RouterProvider router={createMemoryRouter([{ path: "/", element: <LeaveGuard when /> }])} />
    );
    expect(fire()).toBe(true);
    unmount();
    expect(fire()).toBe(false);
  });
});
