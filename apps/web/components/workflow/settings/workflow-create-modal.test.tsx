/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowCreateModal } from "./workflow-create-modal";

vi.mock("@plane/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const setToast = vi.hoisted(() => vi.fn());
vi.mock("@plane/blocks/toast", () => ({ setToast }));

const state = vi.hoisted(() => ({ createWorkflow: vi.fn() }));
vi.mock("@/hooks/store/use-workflow", () => ({ useWorkflow: () => ({ createWorkflow: state.createWorkflow }) }));
vi.mock("@/hooks/store/use-project", () => ({
  useProject: () => ({
    workspaceProjectIds: ["p1", "p2"],
    getProjectById: (id: string) => ({ id, name: id === "p1" ? "Alpha" : "Beta" }),
  }),
}));

const created = { id: "new-id", name: "Flow" };
const onCreated = vi.fn();

beforeEach(() => {
  state.createWorkflow = vi.fn().mockResolvedValue(created);
  onCreated.mockClear();
});

const fill = async () => {
  const user = userEvent.setup();
  render(<WorkflowCreateModal workspaceSlug="ws" isOpen onClose={() => {}} onCreated={onCreated} />);
  await user.type(screen.getByRole("textbox", { name: /workflows.settings.form.name/ }), "Flow");
  return user;
};
const submit = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole("button", { name: "workflows.settings.form.submit" }));

describe("WorkflowCreateModal", () => {
  it("sends the chosen project and hands the created workflow to the caller", async () => {
    const user = await fill();
    await user.selectOptions(screen.getByRole("combobox", { name: /source_project$/ }), "p2");
    await submit(user);
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(created));
    expect(state.createWorkflow).toHaveBeenCalledWith(
      "ws",
      expect.objectContaining({ name: "Flow", source_project_id: "p2" })
    );
  });

  it("sends no source project when none is chosen", async () => {
    const user = await fill();
    await submit(user);
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(created));
    expect(state.createWorkflow.mock.calls[0][1]).not.toHaveProperty("source_project_id");
  });

  it("shows the error toast and does not call onCreated when the server refuses", async () => {
    state.createWorkflow = vi.fn().mockRejectedValue(new Error("refused"));
    const user = await fill();
    await submit(user);
    await waitFor(() => expect(setToast).toHaveBeenCalledWith(expect.objectContaining({ type: "error" })));
    expect(onCreated).not.toHaveBeenCalled();
  });
});
