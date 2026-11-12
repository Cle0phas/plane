/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import { Badge } from "@makeplane/propel/components/badge";
import { Icon } from "@makeplane/propel/components/icon";
import { IconButton } from "@makeplane/propel/components/icon-button";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@makeplane/propel/components/menu";
import {
  DefaultTabOutline,
  DeleteOutline,
  EditOutline,
  MoreHorizontalOutline,
  ToggleOffOutline,
  ToggleOnOutline,
} from "@makeplane/propel/icons";
import { ConfirmDialog } from "@plane/blocks/dialog";
import { setToast } from "@plane/blocks/toast";
import { useTranslation } from "@plane/i18n";
import type { TIssueType, TIssueTypeUpdatePayload } from "@plane/types";
// components
import {
  getApiErrorMessage,
  getDeactivateState,
  getDeleteState,
  getSetDefaultState,
} from "@/components/work-item-types/helpers";
import { WorkItemTypeIcon } from "@/components/work-item-types/work-item-type-icon";
// hooks
import { useWorkItemType } from "@/hooks/store/use-work-item-type";

type TRowProps = {
  workspaceSlug: string;
  workItemType: TIssueType;
  onEdit: (workItemType: TIssueType) => void;
};

const WorkspaceWorkItemTypeRow = observer(function WorkspaceWorkItemTypeRow(props: TRowProps) {
  const { workspaceSlug, workItemType, onEdit } = props;
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const { t } = useTranslation();
  const { updateType, removeType } = useWorkItemType();
  const setDefaultState = getSetDefaultState(workItemType);
  const deactivateState = getDeactivateState(workItemType);
  const deleteState = getDeleteState(workItemType);
  // The reason is visible row text, so assistive tech reads it with the disabled item (spec 6.6).
  const reason = (reasonKey?: string) => (reasonKey ? t(reasonKey) : undefined);

  const runUpdate = async (payload: TIssueTypeUpdatePayload) => {
    try {
      await updateType(workspaceSlug, workItemType.id, payload);
      setToast({
        type: "success",
        title: t("work_item_types.update.toast.success.title"),
        message: t("work_item_types.update.toast.success.message", { name: workItemType.name }),
      });
    } catch (error) {
      setToast({
        type: "error",
        title: t("work_item_types.update.toast.error.title"),
        message: getApiErrorMessage(error) ?? t("work_item_types.update.toast.error.message.default"),
      });
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await removeType(workspaceSlug, workItemType.id);
      setToast({
        type: "success",
        title: t("work_item_types.settings.item_delete_confirmation.toast.success.title"),
        message: t("work_item_types.settings.item_delete_confirmation.toast.success.message"),
      });
      setIsDeleteOpen(false);
    } catch (error) {
      setToast({
        type: "error",
        title: t("work_item_types.settings.item_delete_confirmation.toast.error.title"),
        message:
          getApiErrorMessage(error) ?? t("work_item_types.settings.item_delete_confirmation.toast.error.message"),
      });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <WorkItemTypeIcon workItemType={workItemType} size={18} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-body-sm-medium text-primary">{workItemType.name}</span>
          {workItemType.is_default && <Badge variant="brand" size="xs" label={t("common.default")} />}
          {!workItemType.is_active && (
            <Badge variant="neutral" size="xs" label={t("work_item_types.settings.list.inactive_badge")} />
          )}
        </div>
        {workItemType.description && (
          <p className="truncate text-body-xs-regular text-tertiary">{workItemType.description}</p>
        )}
      </div>
      <span className="shrink-0 text-body-xs-regular text-tertiary">
        {t("work_item_types.settings.list.work_item_count", { count: workItemType.issue_count })}
      </span>
      <Menu>
        <MenuTrigger
          render={
            <IconButton
              type="button"
              variant="ghost"
              size="xs"
              aria-label={t("work_item_types.settings.list.more_actions", { name: workItemType.name })}
              icon={<Icon icon={MoreHorizontalOutline} />}
            />
          }
        />
        <MenuContent side="bottom" align="end">
          <MenuItem
            icon={<Icon icon={EditOutline} />}
            label={t("common.actions.edit")}
            onClick={() => onEdit(workItemType)}
          />
          {!workItemType.is_default && (
            <MenuItem
              icon={<Icon icon={DefaultTabOutline} />}
              label={t("work_item_types.settings.set_as_default")}
              description={reason(setDefaultState.reasonKey)}
              disabled={setDefaultState.disabled}
              onClick={() => void runUpdate({ is_default: true })}
            />
          )}
          {workItemType.is_active ? (
            <MenuItem
              icon={<Icon icon={ToggleOffOutline} />}
              label={t("work_item_types.settings.actions.deactivate")}
              description={reason(deactivateState.reasonKey)}
              disabled={deactivateState.disabled}
              onClick={() => void runUpdate({ is_active: false })}
            />
          ) : (
            <MenuItem
              icon={<Icon icon={ToggleOnOutline} />}
              label={t("work_item_types.settings.actions.reactivate")}
              onClick={() => void runUpdate({ is_active: true })}
            />
          )}
          <MenuSeparator />
          <MenuItem
            variant="danger"
            icon={<Icon icon={DeleteOutline} />}
            label={t("common.actions.delete")}
            description={reason(deleteState.reasonKey)}
            disabled={deleteState.disabled}
            onClick={() => setIsDeleteOpen(true)}
          />
        </MenuContent>
      </Menu>
      <ConfirmDialog
        handleClose={() => setIsDeleteOpen(false)}
        handleSubmit={handleDelete}
        isSubmitting={isDeleting}
        isOpen={isDeleteOpen}
        title={t("work_item_types.settings.item_delete_confirmation.title")}
        content={t("work_item_types.settings.item_delete_confirmation.description")}
        primaryButtonText={{
          loading: t("deleting"),
          default: t("work_item_types.settings.item_delete_confirmation.primary_button"),
        }}
      />
    </li>
  );
});

type TWorkspaceWorkItemTypeListProps = {
  workspaceSlug: string;
  onEdit: (workItemType: TIssueType) => void;
};

export const WorkspaceWorkItemTypeList = observer(function WorkspaceWorkItemTypeList(
  props: TWorkspaceWorkItemTypeListProps
) {
  const { workspaceSlug, onEdit } = props;
  const { t } = useTranslation();
  const { getWorkspaceTypes } = useWorkItemType();

  return (
    <ul aria-label={t("work_item_types.label")} className="divide-y divide-subtle rounded-lg border border-subtle">
      {getWorkspaceTypes(workspaceSlug).map((workItemType) => (
        <WorkspaceWorkItemTypeRow
          key={workItemType.id}
          workspaceSlug={workspaceSlug}
          workItemType={workItemType}
          onEdit={onEdit}
        />
      ))}
    </ul>
  );
});
