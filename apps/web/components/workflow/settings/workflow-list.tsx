/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import Link from "next/link";
import { Button } from "@makeplane/propel/components/button";
import { Tooltip } from "@makeplane/propel/components/tooltip";
import { ConfirmDialog } from "@plane/blocks/dialog";
import { setToast } from "@plane/blocks/toast";
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import type { TWorkflowSummary } from "@plane/types";
import { renderFormattedDate } from "@plane/utils";
// components
import { uniqueName } from "@/components/workflow/editor/graph-model";
// hooks
import { useWorkflow } from "@/hooks/store/use-workflow";
import { useUserPermissions } from "@/hooks/store/user";

type RowProps = { workspaceSlug: string; workflow: TWorkflowSummary; takenNames: string[]; canWrite: boolean };

const CELL_CLASS = "border-b border-subtle p-2 align-top text-body-xs-regular text-secondary";

const WorkflowRow = observer(function WorkflowRow({ workspaceSlug, workflow, takenNames, canWrite }: RowProps) {
  const { t } = useTranslation();
  const { removeWorkflow, duplicateWorkflow } = useWorkflow();
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDuplicating, setIsDuplicating] = useState(false);
  const inUse = workflow.project_count > 0;
  const deleteReasonId = `workflow-delete-reason-${workflow.id}`;
  const projectNamesId = `workflow-projects-${workflow.id}`;
  const editorHref = `/${workspaceSlug}/settings/workflows/${workflow.id}`;
  const projectNames = workflow.projects?.map((project) => project.name).join(", ") ?? "";
  const fail = () =>
    setToast({ type: "error", title: t("common.error.label"), message: t("workflows.settings.error") });

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await removeWorkflow(workspaceSlug, workflow.id);
      setIsDeleteOpen(false);
    } catch {
      fail();
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDuplicate = async () => {
    setIsDuplicating(true);
    try {
      const name = uniqueName(t("workflows.settings.duplicate.copy_name", { name: workflow.name }), takenNames);
      await duplicateWorkflow(workspaceSlug, workflow.id, name);
      setToast({ type: "success", title: t("workflows.settings.duplicate.success"), message: "" });
    } catch {
      fail();
    } finally {
      setIsDuplicating(false);
    }
  };

  const projectCount = t("workflows.settings.project_count", { count: workflow.project_count });

  return (
    <tr>
      <td className={CELL_CLASS}>
        <Link href={editorHref} className="text-body-sm-medium text-primary hover:underline">
          {workflow.name}
        </Link>
      </td>
      <td className={CELL_CLASS}>{workflow.description}</td>
      <td className={CELL_CLASS}>{t("workflows.settings.state_count", { count: workflow.state_count })}</td>
      <td className={CELL_CLASS}>
        {projectNames ? (
          <>
            <Tooltip label={projectNames}>
              <button type="button" aria-describedby={projectNamesId} className="underline decoration-dotted">
                {projectCount}
              </button>
            </Tooltip>
            <span id={projectNamesId} className="sr-only">
              {projectNames}
            </span>
          </>
        ) : (
          projectCount
        )}
      </td>
      <td className={CELL_CLASS}>{renderFormattedDate(workflow.updated_at)}</td>
      {canWrite && (
        <td className={CELL_CLASS}>
          <div className="flex flex-wrap items-center gap-2">
            <Link href={editorHref} className="text-body-xs-medium text-accent-primary hover:underline">
              {t("workflows.settings.edit")}
            </Link>
            <Button
              variant="secondary"
              size="sm"
              stretch="auto"
              loading={isDuplicating}
              label={t("workflows.settings.duplicate.action")}
              onClick={handleDuplicate}
            />
            <Button
              variant="secondary"
              size="sm"
              stretch="auto"
              label={t("workflows.settings.delete.action")}
              disabled={inUse}
              aria-describedby={inUse ? deleteReasonId : undefined}
              onClick={() => setIsDeleteOpen(true)}
            />
          </div>
          {inUse && (
            <p id={deleteReasonId} className="mt-1 text-caption-sm-regular text-tertiary">
              {t("workflows.settings.delete.in_use")}
            </p>
          )}
          <ConfirmDialog
            handleClose={() => setIsDeleteOpen(false)}
            handleSubmit={handleDelete}
            isSubmitting={isDeleting}
            isOpen={isDeleteOpen}
            title={t("workflows.settings.delete.title")}
            content={t("workflows.settings.delete.description")}
            primaryButtonText={{ loading: t("deleting"), default: t("workflows.settings.delete.action") }}
          />
        </td>
      )}
    </tr>
  );
});

const COLUMNS = ["name", "description", "states", "projects", "updated"] as const;

export const WorkspaceWorkflowList = observer(function WorkspaceWorkflowList({
  workspaceSlug,
}: {
  workspaceSlug: string;
}) {
  const { t } = useTranslation();
  const { getWorkspaceWorkflows } = useWorkflow();
  const { allowPermissions } = useUserPermissions();
  // Display only: the server refuses every write from a non-admin.
  const canWrite = allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.WORKSPACE);
  const workflows = getWorkspaceWorkflows(workspaceSlug);
  const takenNames = workflows.map((workflow) => workflow.name);
  const columns = canWrite ? [...COLUMNS, "actions"] : COLUMNS;

  if (workflows.length === 0)
    return <p className="text-body-sm-regular text-tertiary">{t("workflows.settings.empty")}</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-separate border-spacing-0" aria-label={t("workflows.label")}>
        <thead>
          <tr className="text-left text-body-xs-medium text-secondary">
            {columns.map((column) => (
              <th key={column} scope="col" className="border-b border-subtle p-2">
                {t(`workflows.settings.columns.${column}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {workflows.map((workflow) => (
            <WorkflowRow
              key={workflow.id}
              workspaceSlug={workspaceSlug}
              workflow={workflow}
              takenNames={takenNames}
              canWrite={canWrite}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
});
