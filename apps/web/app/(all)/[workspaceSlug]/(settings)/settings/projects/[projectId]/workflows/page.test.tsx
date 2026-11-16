/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import WorkflowsProjectSettingsPage from "./page";

type TSwrResult = { data?: unknown; error?: unknown };

const state = vi.hoisted(() => ({
  reads: {} as Record<string, TSwrResult>,
}));

// SWR is driven by the test: each read answers what the scenario says, keyed by its route.
vi.mock("swr", () => ({
  default: (key: string | null) => (key === null ? {} : (state.reads[key.split("_").slice(0, -1).join("_")] ?? {})),
}));
vi.mock("@plane/constants", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  WORKSPACE_WORKFLOWS: (slug: string) => `WORKFLOWS_${slug}`,
  PROJECT_WORKFLOW_SCHEME: (id: string) => `SCHEME_${id}`,
  WORKSPACE_WORK_ITEM_TYPES: (slug: string) => `WORKSPACE_TYPES_${slug}`,
  PROJECT_WORK_ITEM_TYPES: (id: string) => `PROJECT_TYPES_${id}`,
}));
vi.mock("@plane/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/components/auth-screens/not-authorized-view", () => ({ NotAuthorizedView: () => null }));
vi.mock("@/components/core/page-title", () => ({ PageHead: () => null }));
vi.mock("@/components/settings/content-wrapper", () => ({
  SettingsContentWrapper: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/settings/heading", () => ({ SettingsHeading: () => null }));
vi.mock("./header", () => ({ WorkflowsProjectSettingsHeader: () => null }));
// The tab is where every action lives: not mounted, nothing can be sent.
vi.mock("@/components/workflow/project/project-workflow-scheme", () => ({
  ProjectWorkflowScheme: () => <p>scheme-tab</p>,
}));
vi.mock("@/hooks/store/use-project", () => ({ useProject: () => ({ currentProjectDetails: undefined }) }));
vi.mock("@/hooks/store/use-workflow", () => ({
  useWorkflow: () => ({ fetchWorkflows: vi.fn(), fetchProjectScheme: vi.fn() }),
}));
vi.mock("@/hooks/store/use-work-item-type", () => ({
  useWorkItemType: () => ({ fetchWorkspaceTypes: vi.fn(), fetchProjectTypes: vi.fn() }),
}));
vi.mock("@/hooks/store/user", () => ({
  useUserPermissions: () => ({
    getProjectRoleByWorkspaceSlugAndProjectId: () => 20,
    allowPermissions: () => true,
  }),
}));

const pageProps = { params: { workspaceSlug: "ws", projectId: "p1" } } as unknown as React.ComponentProps<
  typeof WorkflowsProjectSettingsPage
>;
const openPage = () => render(<WorkflowsProjectSettingsPage {...pageProps} />);

beforeEach(() => {
  state.reads = {
    WORKFLOWS: { data: [] },
    SCHEME: { data: { default_workflow_id: "w", items: [] } },
    WORKSPACE_TYPES: { data: [] },
    PROJECT_TYPES: { data: [] },
  };
});

// I4: without the project's types, every per-type line of the scheme would be dropped from the payload.
describe("WorkflowsProjectSettingsPage", () => {
  it("offers no action while the types of the project are not loaded", () => {
    state.reads.PROJECT_TYPES = {};
    openPage();
    expect(screen.queryByText("scheme-tab")).toBeNull();
  });

  it("offers no action while the types of the workspace are not loaded", () => {
    state.reads.WORKSPACE_TYPES = {};
    openPage();
    expect(screen.queryByText("scheme-tab")).toBeNull();
  });

  it("shows the load error when a type list cannot be read", () => {
    state.reads.PROJECT_TYPES = { error: new Error("offline") };
    openPage();
    expect(screen.queryByText("scheme-tab")).toBeNull();
    expect(screen.getByRole("alert").textContent).toBe("workflows.settings.load_error");
  });

  it("keeps the tab when a background refresh of the types fails", () => {
    state.reads.WORKSPACE_TYPES = { data: [], error: new Error("offline") };
    openPage();
    expect(screen.getByText("scheme-tab")).toBeTruthy();
  });

  it("opens the tab for a project without any type", () => {
    openPage();
    expect(screen.getByText("scheme-tab")).toBeTruthy();
  });
});
