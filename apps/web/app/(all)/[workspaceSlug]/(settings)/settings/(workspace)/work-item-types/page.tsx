/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import useSWR from "swr";
// plane imports
import { EUserPermissions, EUserPermissionsLevel, WORKSPACE_WORK_ITEM_TYPES } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { Button } from "@makeplane/propel/components/button";
import { Loader } from "@plane/blocks/skeleton";
import type { TIssueType } from "@plane/types";
// components
import { NotAuthorizedView } from "@/components/auth-screens/not-authorized-view";
import { PageHead } from "@/components/core/page-title";
import { SettingsContentWrapper } from "@/components/settings/content-wrapper";
import { SettingsHeading } from "@/components/settings/heading";
import { WorkItemTypeFormModal } from "@/components/work-item-types/settings/form-modal";
import { WorkspaceWorkItemTypeList } from "@/components/work-item-types/settings/workspace-list";
// hooks
import { useWorkItemType } from "@/hooks/store/use-work-item-type";
import { useWorkspace } from "@/hooks/store/use-workspace";
import { useUserPermissions } from "@/hooks/store/user";
// local imports
import type { Route } from "./+types/page";
import { WorkItemTypesWorkspaceSettingsHeader } from "./header";

function WorkItemTypesSettingsPage({ params }: Route.ComponentProps) {
  const { workspaceSlug } = params;
  const [modalState, setModalState] = useState<{ isOpen: boolean; workItemType?: TIssueType }>({ isOpen: false });
  const { t } = useTranslation();
  const { workspaceUserInfo, allowPermissions } = useUserPermissions();
  const { currentWorkspace } = useWorkspace();
  const { fetchWorkspaceTypes, getWorkspaceTypes } = useWorkItemType();
  const isWorkspaceAdmin = allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.WORKSPACE);
  const { isLoading, error } = useSWR(
    isWorkspaceAdmin ? WORKSPACE_WORK_ITEM_TYPES(workspaceSlug) : null,
    isWorkspaceAdmin ? () => fetchWorkspaceTypes(workspaceSlug) : null
  );
  const workItemTypes = getWorkspaceTypes(workspaceSlug);
  const pageTitle = currentWorkspace?.name ? `${currentWorkspace.name} - ${t("work_item_types.label")}` : undefined;

  if (workspaceUserInfo && !isWorkspaceAdmin) return <NotAuthorizedView section="settings" className="h-auto" />;

  return (
    <SettingsContentWrapper header={<WorkItemTypesWorkspaceSettingsHeader />}>
      <PageHead title={pageTitle} />
      <WorkItemTypeFormModal
        workspaceSlug={workspaceSlug}
        isOpen={modalState.isOpen}
        workItemType={modalState.workItemType}
        onClose={() => setModalState({ isOpen: false })}
      />
      <SettingsHeading
        title={t("work_item_types.label")}
        description={t("work_item_types.settings.list.description")}
        control={
          <Button
            variant="primary"
            size="md"
            stretch="auto"
            label={t("work_item_types.create.button")}
            onClick={() => setModalState({ isOpen: true })}
          />
        }
      />
      <div className="mt-4">
        {error ? (
          <p role="alert" className="text-body-sm-regular text-danger-primary">
            {t("work_item_types.settings.list.load_error")}
          </p>
        ) : isLoading && workItemTypes.length === 0 ? (
          <Loader className="space-y-3">
            <Loader.Item height="56px" />
            <Loader.Item height="56px" />
          </Loader>
        ) : (
          <WorkspaceWorkItemTypeList
            workspaceSlug={workspaceSlug}
            onEdit={(workItemType) => setModalState({ isOpen: true, workItemType })}
          />
        )}
      </div>
    </SettingsContentWrapper>
  );
}

export default observer(WorkItemTypesSettingsPage);
