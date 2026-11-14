/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

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
import { PageHead } from "@/components/core/page-title";
import { WorkflowEditor } from "@/components/workflow/editor/workflow-editor";
// hooks
import { useWorkflow } from "@/hooks/store/use-workflow";
import { useAppRouter } from "@/hooks/use-app-router";
import { useUserPermissions } from "@/hooks/store/user";
// local imports
import type { Route } from "./+types/page";

const SWR_OPTIONS = { revalidateOnFocus: false, revalidateIfStale: false };

function WorkflowEditorPage({ params }: Route.ComponentProps) {
  const { workspaceSlug, workflowId } = params;
  const { t } = useTranslation();
  const router = useAppRouter();
  const { allowPermissions } = useUserPermissions();
  const {
    fetchWorkflowDetail,
    fetchStatuses,
    fetchCandidates,
    getWorkflowDetail,
    getWorkspaceStatuses,
    getWorkspaceCandidates,
    saveGraph,
  } = useWorkflow();
  const isWorkspaceAdmin = allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.WORKSPACE);
  const detail = useSWR(WORKFLOW_DETAIL(workflowId), () => fetchWorkflowDetail(workspaceSlug, workflowId), SWR_OPTIONS);
  const statuses = useSWR(WORKSPACE_WORKFLOW_STATUSES(workspaceSlug), () => fetchStatuses(workspaceSlug), SWR_OPTIONS);
  // Admins only (R15): the server refuses everyone else; a failure only shortens the list.
  useSWR(
    isWorkspaceAdmin ? WORKSPACE_WORKFLOW_CANDIDATES(workspaceSlug) : null,
    isWorkspaceAdmin ? () => fetchCandidates(workspaceSlug) : null,
    SWR_OPTIONS
  );
  const workflow = getWorkflowDetail(workflowId);

  return (
    <div className="relative size-full overflow-hidden rounded-lg border border-subtle bg-surface-1">
      <PageHead title={workflow ? `${workflow.name} - ${t("workflows.label")}` : undefined} />
      {detail.error || statuses.error ? (
        <p role="alert" className="p-6 text-body-sm-regular text-danger-primary">
          {t("workflows.settings.load_error")}
        </p>
      ) : !workflow || !statuses.data ? (
        <Loader className="space-y-3 p-6">
          <Loader.Item height="560px" />
        </Loader>
      ) : (
        <WorkflowEditor
          key={workflow.id}
          workflow={workflow}
          statuses={getWorkspaceStatuses(workspaceSlug)}
          candidates={getWorkspaceCandidates(workspaceSlug)}
          readOnly={!isWorkspaceAdmin}
          onSave={(payload) => saveGraph(workspaceSlug, workflow.id, payload)}
          onClose={() => router.push(`/${workspaceSlug}/settings/workflows`)}
        />
      )}
    </div>
  );
}

export default observer(WorkflowEditorPage);
