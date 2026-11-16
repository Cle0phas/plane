/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect } from "react";
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import WorkflowEditorPage from "./page";

type TSwrResult = { data?: unknown; error?: unknown };
type TEditorProps = { workflow: { version: string }; onReload: () => Promise<void> };

const state = vi.hoisted(() => ({
  canRead: true,
  isAdmin: true,
  detail: {} as TSwrResult,
  statuses: {} as TSwrResult,
  workflow: undefined as { id: string; name: string; version: string } | undefined,
  swrCalls: [] as { key: unknown; options: Record<string, unknown> }[],
  fetchWorkflowDetail: vi.fn(),
  fetchStatuses: vi.fn(),
  fetchCandidates: vi.fn(),
  mounts: 0,
  editor: null as TEditorProps | null,
}));

// SWR is driven by the test: each read answers what the scenario says, keyed by its route.
vi.mock("swr", () => ({
  default: (key: string | null, _fetcher: unknown, options: Record<string, unknown>) => {
    state.swrCalls.push({ key, options });
    if (key === null) return {};
    if (key.startsWith("WORKFLOW_DETAIL")) return state.detail;
    if (key.startsWith("WORKSPACE_WORKFLOW_STATUSES")) return state.statuses;
    return {};
  },
}));
vi.mock("@plane/constants", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  WORKFLOW_DETAIL: (id: string) => `WORKFLOW_DETAIL_${id}`,
  WORKSPACE_WORKFLOW_STATUSES: (slug: string) => `WORKSPACE_WORKFLOW_STATUSES_${slug}`,
  WORKSPACE_WORKFLOW_CANDIDATES: (slug: string) => `WORKSPACE_WORKFLOW_CANDIDATES_${slug}`,
}));
vi.mock("@plane/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/components/auth-screens/not-authorized-view", () => ({
  NotAuthorizedView: () => <p>not-authorized</p>,
}));
vi.mock("@/components/core/page-title", () => ({ PageHead: () => null }));
vi.mock("@/components/workflow/editor/leave-guard", () => ({ LeaveGuard: () => null }));
vi.mock("@/components/workflow/editor/workflow-editor", () => ({
  WorkflowEditor: (props: TEditorProps) => {
    state.editor = props;
    useEffect(() => {
      state.mounts += 1;
    }, []);
    return <p>editor {props.workflow.version}</p>;
  },
}));
vi.mock("@/hooks/store/use-workflow", () => ({
  useWorkflow: () => ({
    fetchWorkflowDetail: state.fetchWorkflowDetail,
    fetchStatuses: state.fetchStatuses,
    fetchCandidates: state.fetchCandidates,
    getWorkflowDetail: () => state.workflow,
    getWorkspaceStatuses: () => [],
    getWorkspaceCandidates: () => [],
    saveGraph: vi.fn(),
    sendPresence: vi.fn(),
  }),
}));
vi.mock("@/hooks/use-app-router", () => ({ useAppRouter: () => ({ back: vi.fn(), push: vi.fn() }) }));
vi.mock("@/hooks/store/user", () => ({
  useUserPermissions: () => ({
    workspaceInfoBySlug: () => ({}),
    // [ADMIN] alone asks for an admin, [ADMIN, MEMBER] for a reader.
    allowPermissions: (roles: unknown[]) => (roles.length === 1 ? state.isAdmin : state.canRead),
  }),
}));

// The page reads its params only; the rest of the route props is the router's.
const pageProps = { params: { workspaceSlug: "ws", workflowId: "w" } } as unknown as React.ComponentProps<
  typeof WorkflowEditorPage
>;
const openPage = () => render(<WorkflowEditorPage {...pageProps} />);

beforeEach(() => {
  state.canRead = true;
  state.isAdmin = true;
  state.workflow = { id: "w", name: "Software", version: "v1" };
  state.detail = { data: state.workflow };
  state.statuses = { data: [] };
  state.swrCalls = [];
  state.fetchWorkflowDetail = vi.fn().mockResolvedValue(undefined);
  state.fetchStatuses = vi.fn().mockResolvedValue(undefined);
  state.fetchCandidates = vi.fn().mockResolvedValue(undefined);
  state.mounts = 0;
  state.editor = null;
});

describe("WorkflowEditorPage", () => {
  it("tells a guest he may not read and asks the server nothing", () => {
    state.canRead = false;
    state.isAdmin = false;
    openPage();
    expect(screen.getByText("not-authorized")).toBeTruthy();
    expect(state.swrCalls.length).toBeGreaterThan(0);
    expect(state.swrCalls.every((call) => call.key === null)).toBe(true);
    expect(state.editor).toBeNull();
  });

  // C1: a reconnect must not refresh the workflow under a dirty draft.
  it("does not refresh the reads on focus, staleness or reconnect", () => {
    openPage();
    for (const { options } of state.swrCalls)
      expect(options).toMatchObject({
        revalidateOnFocus: false,
        revalidateIfStale: false,
        revalidateOnReconnect: false,
      });
  });

  // D8: SWR keeps the data of a failed refresh; the editor and its draft stay.
  it("keeps the editor when a background refresh fails", () => {
    state.detail = { data: state.workflow, error: new Error("offline") };
    state.statuses = { data: [], error: new Error("offline") };
    openPage();
    expect(screen.getByText("editor v1")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows the load error when there is nothing to show", () => {
    state.workflow = undefined;
    state.detail = { error: new Error("offline") };
    openPage();
    expect(screen.getByRole("alert").textContent).toBe("workflows.settings.load_error");
  });

  it("reads everything again and remounts the editor on a reload", async () => {
    openPage();
    expect(state.mounts).toBe(1);
    await act(() => state.editor!.onReload());
    expect(state.fetchWorkflowDetail).toHaveBeenCalledWith("ws", "w");
    expect(state.fetchStatuses).toHaveBeenCalledWith("ws");
    expect(state.fetchCandidates).toHaveBeenCalledWith("ws");
    expect(state.mounts).toBe(2);
  });

  // The proposed states only shorten a list: their failure must not keep the admin on a stale editor.
  it("still remounts the editor when the proposed states cannot be read", async () => {
    state.fetchCandidates = vi.fn().mockRejectedValue(new Error("offline"));
    openPage();
    await act(() => state.editor!.onReload());
    expect(state.mounts).toBe(2);
  });
});
