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
  PROJECT_WORKFLOW_SCHEME,
  WORKSPACE_WORKFLOWS,
} from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { Loader } from "@plane/blocks/skeleton";
// components
import { NotAuthorizedView } from "@/components/auth-screens/not-authorized-view";
import { PageHead } from "@/components/core/page-title";
import { SettingsContentWrapper } from "@/components/settings/content-wrapper";
import { SettingsHeading } from "@/components/settings/heading";
import { ProjectWorkflowScheme } from "@/components/workflow/project/project-workflow-scheme";
// hooks
import { useProject } from "@/hooks/store/use-project";
import { useWorkflow } from "@/hooks/store/use-workflow";
import { useUserPermissions } from "@/hooks/store/user";
// local imports
import type { Route } from "./+types/page";
import { WorkflowsProjectSettingsHeader } from "./header";

function WorkflowsProjectSettingsPage({ params }: Route.ComponentProps) {
  const { workspaceSlug, projectId } = params;
  const { t } = useTranslation();
  const { currentProjectDetails } = useProject();
  const { getProjectRoleByWorkspaceSlugAndProjectId, allowPermissions } = useUserPermissions();
  const { fetchWorkflows, fetchProjectScheme } = useWorkflow();
  // A4 is checked again by the server on every call.
  const isRoleKnown = getProjectRoleByWorkspaceSlugAndProjectId(workspaceSlug, projectId) !== undefined;
  const canManage = allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.PROJECT, workspaceSlug, projectId);
  const workflows = useSWR(
    canManage ? WORKSPACE_WORKFLOWS(workspaceSlug) : null,
    canManage ? () => fetchWorkflows(workspaceSlug) : null
  );
  const scheme = useSWR(
    canManage ? PROJECT_WORKFLOW_SCHEME(projectId) : null,
    canManage ? () => fetchProjectScheme(workspaceSlug, projectId) : null
  );
  const pageTitle = currentProjectDetails?.name ? `${currentProjectDetails.name} - ${t("workflows.label")}` : undefined;
  const loader = (
    <Loader className="space-y-3">
      <Loader.Item height="56px" />
      <Loader.Item height="56px" />
    </Loader>
  );

  if (!isRoleKnown)
    return <SettingsContentWrapper header={<WorkflowsProjectSettingsHeader />}>{loader}</SettingsContentWrapper>;
  if (!canManage) return <NotAuthorizedView section="settings" isProjectView className="h-auto" />;

  return (
    <SettingsContentWrapper header={<WorkflowsProjectSettingsHeader />}>
      <PageHead title={pageTitle} />
      <SettingsHeading title={t("workflows.label")} description={t("workflows.scheme.description")} />
      <div className="mt-4">
        {(workflows.error && !workflows.data) || (scheme.error && !scheme.data) ? (
          <p role="alert" className="text-body-sm-regular text-danger-primary">
            {t("workflows.settings.load_error")}
          </p>
        ) : !workflows.data || !scheme.data ? (
          loader
        ) : (
          <ProjectWorkflowScheme workspaceSlug={workspaceSlug} projectId={projectId} />
        )}
      </div>
    </SettingsContentWrapper>
  );
}

export default observer(WorkflowsProjectSettingsPage);
