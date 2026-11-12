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
  PROJECT_WORK_ITEM_TYPES,
  WORKSPACE_WORK_ITEM_TYPES,
} from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { Loader } from "@plane/blocks/skeleton";
// components
import { NotAuthorizedView } from "@/components/auth-screens/not-authorized-view";
import { PageHead } from "@/components/core/page-title";
import { SettingsContentWrapper } from "@/components/settings/content-wrapper";
import { SettingsHeading } from "@/components/settings/heading";
import { ProjectWorkItemTypeList } from "@/components/work-item-types/settings/project-list";
// hooks
import { useProject } from "@/hooks/store/use-project";
import { useWorkItemType } from "@/hooks/store/use-work-item-type";
import { useUserPermissions } from "@/hooks/store/user";
// local imports
import type { Route } from "./+types/page";
import { WorkItemTypesProjectSettingsHeader } from "./header";

function WorkItemTypesProjectSettingsPage({ params }: Route.ComponentProps) {
  const { workspaceSlug, projectId } = params;
  const { t } = useTranslation();
  const { currentProjectDetails } = useProject();
  const { getProjectRoleByWorkspaceSlugAndProjectId, allowPermissions } = useUserPermissions();
  const { fetchWorkspaceTypes, fetchProjectTypes } = useWorkItemType();
  // The store already maps a workspace admin to the project admin role; the server checks R3 again on every call.
  const isRoleKnown = getProjectRoleByWorkspaceSlugAndProjectId(workspaceSlug, projectId) !== undefined;
  const canManage = allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.PROJECT, workspaceSlug, projectId);
  const {
    data: types,
    error: typesError,
    isLoading: isTypesLoading,
  } = useSWR(
    canManage ? WORKSPACE_WORK_ITEM_TYPES(workspaceSlug) : null,
    canManage ? () => fetchWorkspaceTypes(workspaceSlug) : null
  );
  const {
    data: links,
    error: linksError,
    isLoading: isLinksLoading,
  } = useSWR(
    canManage ? PROJECT_WORK_ITEM_TYPES(projectId) : null,
    canManage ? () => fetchProjectTypes(workspaceSlug, projectId) : null
  );
  // A failed background revalidation must not hide a list that loaded fine.
  const hasLoadError = (!!typesError && !types) || (!!linksError && !links);
  const pageTitle = currentProjectDetails?.name
    ? `${currentProjectDetails.name} - ${t("work_item_types.label")}`
    : undefined;

  const loader = (
    <Loader className="space-y-3">
      <Loader.Item height="56px" />
      <Loader.Item height="56px" />
    </Loader>
  );

  // Until the role is known, show no controls.
  if (!isRoleKnown)
    return <SettingsContentWrapper header={<WorkItemTypesProjectSettingsHeader />}>{loader}</SettingsContentWrapper>;
  if (!canManage) return <NotAuthorizedView section="settings" isProjectView className="h-auto" />;

  return (
    <SettingsContentWrapper header={<WorkItemTypesProjectSettingsHeader />}>
      <PageHead title={pageTitle} />
      <SettingsHeading
        title={t("work_item_types.label")}
        description={t("work_item_types.settings.project.description")}
      />
      <div className="mt-4">
        {hasLoadError ? (
          <p role="alert" className="text-body-sm-regular text-danger-primary">
            {t("work_item_types.settings.list.load_error")}
          </p>
        ) : isTypesLoading || isLinksLoading ? (
          loader
        ) : (
          <ProjectWorkItemTypeList workspaceSlug={workspaceSlug} projectId={projectId} />
        )}
      </div>
    </SettingsContentWrapper>
  );
}

export default observer(WorkItemTypesProjectSettingsPage);
