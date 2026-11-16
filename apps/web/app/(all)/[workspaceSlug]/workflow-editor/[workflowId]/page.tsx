/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import useSWR from "swr";
// plane imports
import {
  EUserPermissions,
  EUserPermissionsLevel,
  WORKFLOW_DETAIL,
  WORKSPACE_WORKFLOW_CANDIDATES,
  WORKSPACE_WORKFLOW_STATUSES,
} from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { Loader } from "@plane/blocks/skeleton";
// components
import { NotAuthorizedView } from "@/components/auth-screens/not-authorized-view";
import { PageHead } from "@/components/core/page-title";
import { LeaveGuard } from "@/components/workflow/editor/leave-guard";
import { WorkflowEditor } from "@/components/workflow/editor/workflow-editor";
// hooks
import { useWorkflow } from "@/hooks/store/use-workflow";
import { useAppRouter } from "@/hooks/use-app-router";
import { useUserPermissions } from "@/hooks/store/user";
// local imports
import type { Route } from "./+types/page";
import { closeTarget } from "./close-target";

const SWR_OPTIONS = { revalidateOnFocus: false, revalidateIfStale: false };

function WorkflowEditorPage({ params }: Route.ComponentProps) {
  const { workspaceSlug, workflowId } = params;
  const { t } = useTranslation();
  const router = useAppRouter();
  const { workspaceInfoBySlug, allowPermissions } = useUserPermissions();
  const {
    fetchWorkflowDetail,
    fetchStatuses,
    fetchCandidates,
    getWorkflowDetail,
    getWorkspaceStatuses,
    getWorkspaceCandidates,
    saveGraph,
    sendPresence,
  } = useWorkflow();
  const isWorkspaceAdmin = allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.WORKSPACE);
  const [dirty, setDirty] = useState(false);
  // Bumped by a reload: the editor is remounted and starts from the workflow just read (Y5).
  const [reloads, setReloads] = useState(0);
  const isRoleKnown = !!workspaceInfoBySlug(workspaceSlug);
  // Guests read no workflow (spec 6.6): the server refuses them, the page says so without asking it.
  const canRead = allowPermissions([EUserPermissions.ADMIN, EUserPermissions.MEMBER], EUserPermissionsLevel.WORKSPACE);
  const shouldFetch = isRoleKnown && canRead;
  const detail = useSWR(
    shouldFetch ? WORKFLOW_DETAIL(workflowId) : null,
    () => fetchWorkflowDetail(workspaceSlug, workflowId),
    SWR_OPTIONS
  );
  const statuses = useSWR(
    shouldFetch ? WORKSPACE_WORKFLOW_STATUSES(workspaceSlug) : null,
    () => fetchStatuses(workspaceSlug),
    SWR_OPTIONS
  );
  // Admins only (R15): the server refuses everyone else; a failure only shortens the list.
  useSWR(
    shouldFetch && isWorkspaceAdmin ? WORKSPACE_WORKFLOW_CANDIDATES(workspaceSlug) : null,
    () => fetchCandidates(workspaceSlug),
    SWR_OPTIONS
  );

  const reload = async () => {
    await Promise.all([
      fetchWorkflowDetail(workspaceSlug, workflowId),
      fetchStatuses(workspaceSlug),
      isWorkspaceAdmin ? fetchCandidates(workspaceSlug) : undefined,
    ]);
    setReloads((count) => count + 1);
  };
  const workflow = getWorkflowDetail(workflowId);

  return (
    <div className="relative size-full overflow-hidden rounded-lg border border-subtle bg-surface-1">
      <PageHead title={workflow ? `${workflow.name} - ${t("workflows.label")}` : undefined} />
      <LeaveGuard when={dirty} />
      {isRoleKnown && !canRead ? (
        <NotAuthorizedView section="settings" className="h-auto" />
      ) : detail.error || statuses.error ? (
        <p role="alert" className="p-6 text-body-sm-regular text-danger-primary">
          {t("workflows.settings.load_error")}
        </p>
      ) : !workflow || !statuses.data ? (
        <Loader className="space-y-3 p-6">
          <Loader.Item height="560px" />
        </Loader>
      ) : (
        <WorkflowEditor
          key={`${workflow.id}:${reloads}`}
          workflow={workflow}
          statuses={getWorkspaceStatuses(workspaceSlug)}
          candidates={getWorkspaceCandidates(workspaceSlug)}
          readOnly={!isWorkspaceAdmin}
          onSave={(payload) => saveGraph(workspaceSlug, workflow.id, payload)}
          onReload={reload}
          onPresence={
            isWorkspaceAdmin ? (editing: boolean) => sendPresence(workspaceSlug, workflowId, editing) : undefined
          }
          onDirtyChange={setDirty}
          onClose={() => {
            const target = closeTarget(workspaceSlug, isWorkspaceAdmin, window.history.state?.idx);
            if (target.kind === "back") router.back();
            else router.push(target.href);
          }}
        />
      )}
    </div>
  );
}

export default observer(WorkflowEditorPage);
