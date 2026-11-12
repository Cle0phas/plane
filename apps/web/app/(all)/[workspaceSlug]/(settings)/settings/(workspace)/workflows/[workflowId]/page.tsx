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
  WORKSPACE_WORKFLOW_STATUSES,
} from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { Loader } from "@plane/blocks/skeleton";
// components
import { PageHead } from "@/components/core/page-title";
import { SettingsContentWrapper } from "@/components/settings/content-wrapper";
import { WorkflowEditor } from "@/components/workflow/editor/workflow-editor";
// hooks
import { useWorkflow } from "@/hooks/store/use-workflow";
import { useUserPermissions } from "@/hooks/store/user";
// local imports
import { WorkflowsWorkspaceSettingsHeader } from "../header";
import type { Route } from "./+types/page";

function WorkflowEditorPage({ params }: Route.ComponentProps) {
  const { workspaceSlug, workflowId } = params;
  const { t } = useTranslation();
  const { allowPermissions } = useUserPermissions();
  const { fetchWorkflowDetail, fetchStatuses, getWorkflowDetail, getWorkspaceStatuses } = useWorkflow();
  const isWorkspaceAdmin = allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.WORKSPACE);
  const detail = useSWR(WORKFLOW_DETAIL(workflowId), () => fetchWorkflowDetail(workspaceSlug, workflowId), {
    revalidateOnFocus: false,
    revalidateIfStale: false,
  });
  const statuses = useSWR(WORKSPACE_WORKFLOW_STATUSES(workspaceSlug), () => fetchStatuses(workspaceSlug), {
    revalidateOnFocus: false,
    revalidateIfStale: false,
  });
  const workflow = getWorkflowDetail(workflowId);

  return (
    <SettingsContentWrapper header={<WorkflowsWorkspaceSettingsHeader />}>
      <PageHead title={workflow ? `${workflow.name} - ${t("workflows.label")}` : undefined} />
      {detail.error || statuses.error ? (
        <p role="alert" className="text-body-sm-regular text-danger-primary">
          {t("workflows.settings.load_error")}
        </p>
      ) : !workflow || !statuses.data ? (
        <Loader className="space-y-3">
          <Loader.Item height="560px" />
        </Loader>
      ) : (
        <WorkflowEditor
          key={workflow.id}
          workspaceSlug={workspaceSlug}
          workflow={workflow}
          statuses={getWorkspaceStatuses(workspaceSlug)}
          readOnly={!isWorkspaceAdmin}
        />
      )}
    </SettingsContentWrapper>
  );
}

export default observer(WorkflowEditorPage);
