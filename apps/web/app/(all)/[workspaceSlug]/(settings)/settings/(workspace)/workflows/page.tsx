/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import useSWR from "swr";
// plane imports
import { EUserPermissions, EUserPermissionsLevel, WORKSPACE_WORKFLOWS } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { Button } from "@makeplane/propel/components/button";
import { Loader } from "@plane/blocks/skeleton";
// components
import { NotAuthorizedView } from "@/components/auth-screens/not-authorized-view";
import { PageHead } from "@/components/core/page-title";
import { SettingsContentWrapper } from "@/components/settings/content-wrapper";
import { SettingsHeading } from "@/components/settings/heading";
import { WorkflowCreateModal } from "@/components/workflow/settings/workflow-create-modal";
import { WorkspaceWorkflowList } from "@/components/workflow/settings/workflow-list";
// hooks
import { useAppRouter } from "@/hooks/use-app-router";
import { useWorkflow } from "@/hooks/store/use-workflow";
import { useWorkspace } from "@/hooks/store/use-workspace";
import { useUserPermissions } from "@/hooks/store/user";
// local imports
import type { Route } from "./+types/page";
import { WorkflowsWorkspaceSettingsHeader } from "./header";

function WorkflowsSettingsPage({ params }: Route.ComponentProps) {
  const { workspaceSlug } = params;
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const router = useAppRouter();
  const { t } = useTranslation();
  const { workspaceUserInfo, allowPermissions } = useUserPermissions();
  const { currentWorkspace } = useWorkspace();
  const { fetchWorkflows, getWorkspaceWorkflows } = useWorkflow();
  const isWorkspaceAdmin = allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.WORKSPACE);
  const { isLoading, error } = useSWR(
    isWorkspaceAdmin ? WORKSPACE_WORKFLOWS(workspaceSlug) : null,
    isWorkspaceAdmin ? () => fetchWorkflows(workspaceSlug) : null
  );
  const pageTitle = currentWorkspace?.name ? `${currentWorkspace.name} - ${t("workflows.label")}` : undefined;
  const loader = (
    <Loader className="space-y-3">
      <Loader.Item height="56px" />
      <Loader.Item height="56px" />
    </Loader>
  );

  // Until the role is known, show neither the list nor the create button.
  if (!workspaceUserInfo)
    return <SettingsContentWrapper header={<WorkflowsWorkspaceSettingsHeader />}>{loader}</SettingsContentWrapper>;
  if (!isWorkspaceAdmin) return <NotAuthorizedView section="settings" className="h-auto" />;

  return (
    <SettingsContentWrapper header={<WorkflowsWorkspaceSettingsHeader />}>
      <PageHead title={pageTitle} />
      <WorkflowCreateModal
        workspaceSlug={workspaceSlug}
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onCreated={(workflow) => {
          setIsCreateOpen(false);
          router.push(`/${workspaceSlug}/settings/workflows/${workflow.id}`);
        }}
      />
      <SettingsHeading
        title={t("workflows.label")}
        description={t("workflows.settings.description")}
        control={
          <Button
            variant="primary"
            size="md"
            stretch="auto"
            label={t("workflows.settings.create")}
            onClick={() => setIsCreateOpen(true)}
          />
        }
      />
      <div className="mt-4">
        {error ? (
          <p role="alert" className="text-body-sm-regular text-danger-primary">
            {t("workflows.settings.load_error")}
          </p>
        ) : isLoading && getWorkspaceWorkflows(workspaceSlug).length === 0 ? (
          loader
        ) : (
          <WorkspaceWorkflowList workspaceSlug={workspaceSlug} />
        )}
      </div>
    </SettingsContentWrapper>
  );
}

export default observer(WorkflowsSettingsPage);
