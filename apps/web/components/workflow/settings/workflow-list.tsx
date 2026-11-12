/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import Link from "next/link";
import { Button } from "@makeplane/propel/components/button";
import { ConfirmDialog } from "@plane/blocks/dialog";
import { setToast } from "@plane/blocks/toast";
import { useTranslation } from "@plane/i18n";
import type { TWorkflowSummary } from "@plane/types";
// hooks
import { useWorkflow } from "@/hooks/store/use-workflow";

type RowProps = { workspaceSlug: string; workflow: TWorkflowSummary };

const WorkflowRow = observer(function WorkflowRow({ workspaceSlug, workflow }: RowProps) {
  const { t } = useTranslation();
  const { removeWorkflow } = useWorkflow();
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const inUse = workflow.project_count > 0;
  const deleteReasonId = `workflow-delete-reason-${workflow.id}`;

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await removeWorkflow(workspaceSlug, workflow.id);
      setIsDeleteOpen(false);
    } catch {
      setToast({ type: "error", title: t("common.error.label"), message: t("workflows.settings.error") });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <li className="flex items-center gap-4 border-b border-subtle px-2 py-3">
      <div className="min-w-0 flex-1">
        <Link
          href={`/${workspaceSlug}/settings/workflows/${workflow.id}`}
          className="text-body-sm-medium text-primary hover:underline"
        >
          {workflow.name}
        </Link>
        {workflow.projects && workflow.projects.length > 0 && (
          <p className="truncate text-caption-sm-regular text-tertiary">
            {workflow.projects.map((project) => project.name).join(", ")}
          </p>
        )}
      </div>
      <span className="w-24 text-body-xs-regular text-secondary">
        {t("workflows.settings.state_count", { count: workflow.state_count })}
      </span>
      <span className="w-24 text-body-xs-regular text-secondary">
        {t("workflows.settings.project_count", { count: workflow.project_count })}
      </span>
      <Button
        variant="secondary"
        size="sm"
        stretch="auto"
        label={t("workflows.settings.delete.action")}
        disabled={inUse}
        aria-describedby={inUse ? deleteReasonId : undefined}
        onClick={() => setIsDeleteOpen(true)}
      />
      {inUse && (
        <span id={deleteReasonId} className="sr-only">
          {t("workflows.settings.delete.in_use")}
        </span>
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
    </li>
  );
});

export const WorkspaceWorkflowList = observer(function WorkspaceWorkflowList({
  workspaceSlug,
}: {
  workspaceSlug: string;
}) {
  const { t } = useTranslation();
  const { getWorkspaceWorkflows } = useWorkflow();
  const workflows = getWorkspaceWorkflows(workspaceSlug);

  if (workflows.length === 0)
    return <p className="text-body-sm-regular text-tertiary">{t("workflows.settings.empty")}</p>;
  return (
    <ul aria-label={t("workflows.label")}>
      {workflows.map((workflow) => (
        <WorkflowRow key={workflow.id} workspaceSlug={workspaceSlug} workflow={workflow} />
      ))}
    </ul>
  );
});
