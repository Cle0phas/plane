/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { Fragment, useState } from "react";
import { observer } from "mobx-react";
import Link from "next/link";
import { Button } from "@makeplane/propel/components/button";
import { Icon } from "@makeplane/propel/components/icon";
import { IconButton } from "@makeplane/propel/components/icon-button";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuTrigger,
} from "@makeplane/propel/components/menu";
import { Tooltip } from "@makeplane/propel/components/tooltip";
import { InfoOutline, MoreHorizontalOutline, SearchOutline } from "@makeplane/propel/icons";
import { ConfirmDialog } from "@plane/blocks/dialog";
import { setToast } from "@plane/blocks/toast";
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import type { TWorkflowSummary } from "@plane/types";
import { renderFormattedDate } from "@plane/utils";
// components
import { uniqueName, toneOf } from "@/components/workflow/editor/graph-model";
import { BAR_CLASS } from "@/components/workflow/editor/tones";
import { StateLozenge } from "@/components/workflow/state-lozenge";
// hooks
import { useWorkflow } from "@/hooks/store/use-workflow";
import { useUserPermissions } from "@/hooks/store/user";

type TUsage = "all" | "used" | "unused";
const USAGES: TUsage[] = ["all", "used", "unused"];
const PREVIEW_SIZE = 5;
const GROUP_ORDER = ["backlog", "unstarted", "started", "completed", "cancelled"] as const;
const CELL_CLASS = "border-t border-subtle px-4 py-3.5 align-top text-body-sm-regular text-secondary";

function CategoryBar({ states }: { states: TWorkflowSummary["states"] }) {
  return (
    <div aria-hidden className="mt-2 flex h-1 w-36 gap-0.5 overflow-hidden rounded-xs">
      {GROUP_ORDER.map((group) => {
        const count = states.filter((item) => item.group === group).length;
        return count > 0 ? <span key={group} className={BAR_CLASS[toneOf(group)]} style={{ flexGrow: count }} /> : null;
      })}
    </div>
  );
}

function StatePreview({ states }: { states: TWorkflowSummary["states"] }) {
  const rest = states.slice(PREVIEW_SIZE);
  return (
    <div className="flex flex-wrap items-center gap-1">
      {states.slice(0, PREVIEW_SIZE).map((item, index) => (
        // A status appears once per workflow, so its name is a stable key.
        <Fragment key={item.name}>
          {index > 0 && (
            <span aria-hidden className="text-caption-md-regular text-tertiary">
              →
            </span>
          )}
          <StateLozenge name={item.name} group={item.group} />
        </Fragment>
      ))}
      {rest.length > 0 && (
        <span
          title={rest.map((item) => item.name).join(", ")}
          className="rounded-sm bg-layer-2 px-1.5 py-0.5 text-caption-md-medium text-secondary"
        >
          +{rest.length}
        </span>
      )}
    </div>
  );
}

type RowProps = { workspaceSlug: string; workflow: TWorkflowSummary; takenNames: string[]; canWrite: boolean };

const WorkflowRow = observer(function WorkflowRow({ workspaceSlug, workflow, takenNames, canWrite }: RowProps) {
  const { t } = useTranslation();
  const { removeWorkflow, duplicateWorkflow } = useWorkflow();
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDuplicating, setIsDuplicating] = useState(false);
  const inUse = workflow.project_count > 0;
  const isEmpty = workflow.state_count === 0;
  const projectNamesId = `workflow-projects-${workflow.id}`;
  const descriptionId = `workflow-description-${workflow.id}`;
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
  const counts = [t("workflows.settings.state_count", { count: workflow.state_count })];
  if (!isEmpty) counts.push(t("workflows.settings.transition_count", { count: workflow.transition_count }));

  return (
    <tr>
      <td className={CELL_CLASS}>
        <div className="flex flex-wrap items-center gap-1.5">
          <Link href={editorHref} className="text-body-sm-semibold text-accent-primary hover:underline">
            {workflow.name}
          </Link>
          {workflow.description && (
            <>
              <Tooltip label={workflow.description}>
                <button
                  type="button"
                  aria-label={t("workflows.settings.description_label", { name: workflow.name })}
                  aria-describedby={descriptionId}
                  className="inline-flex text-tertiary hover:text-secondary max-md:min-h-11 max-md:min-w-11 max-md:items-center max-md:justify-center"
                >
                  <InfoOutline className="size-3.5" aria-hidden />
                </button>
              </Tooltip>
              <span id={descriptionId} className="sr-only">
                {workflow.description}
              </span>
            </>
          )}
          {isEmpty && (
            <span className="rounded-sm bg-warning-subtle px-1.5 py-px text-caption-sm-medium font-bold text-warning-primary uppercase">
              {t("workflows.settings.empty_badge")}
            </span>
          )}
        </div>
        <p className="mt-1 text-caption-md-regular text-tertiary">{counts.join(" · ")}</p>
        {!isEmpty && <CategoryBar states={workflow.states} />}
      </td>
      <td className={CELL_CLASS}>
        {isEmpty ? (
          <span className="text-caption-md-regular text-tertiary">
            {t("workflows.settings.no_state")}
            {canWrite && (
              <>
                {", "}
                <Link href={editorHref} className="text-accent-primary hover:underline">
                  {t("workflows.settings.add_first_state")}
                </Link>
              </>
            )}
          </span>
        ) : (
          <StatePreview states={workflow.states} />
        )}
      </td>
      <td className={CELL_CLASS}>
        {!inUse ? (
          <span className="text-caption-md-regular text-tertiary">{t("workflows.settings.not_used")}</span>
        ) : projectNames ? (
          <>
            <Tooltip label={projectNames}>
              <button
                type="button"
                aria-describedby={projectNamesId}
                className="rounded-full bg-layer-2 px-2 py-0.5 text-caption-md-regular text-primary"
              >
                {projectCount}
              </button>
            </Tooltip>
            <span id={projectNamesId} className="sr-only">
              {projectNames}
            </span>
          </>
        ) : (
          <span className="rounded-full bg-layer-2 px-2 py-0.5 text-caption-md-regular text-primary">
            {projectCount}
          </span>
        )}
      </td>
      <td className={CELL_CLASS}>{renderFormattedDate(workflow.updated_at)}</td>
      {canWrite && (
        <td className={`${CELL_CLASS} text-right whitespace-nowrap`}>
          <div className="inline-flex items-center gap-1.5">
            <Link href={editorHref} className="text-body-sm-medium text-accent-primary hover:underline">
              {t("workflows.settings.edit")}
            </Link>
            <Menu>
              <MenuTrigger
                render={
                  <IconButton
                    icon={<Icon icon={MoreHorizontalOutline} />}
                    aria-label={t("workflows.settings.more_actions", { name: workflow.name })}
                    variant="ghost"
                    size="sm"
                  />
                }
              />
              <MenuContent side="bottom" align="end">
                <MenuItem
                  label={t("workflows.settings.duplicate.action")}
                  disabled={isDuplicating}
                  onClick={() => void handleDuplicate()}
                />
                <MenuItem
                  variant="danger"
                  label={t("workflows.settings.delete.action")}
                  // A disabled row gets neither hover nor focus reliably: the reason is a line of the row.
                  description={
                    inUse ? t("workflows.settings.delete.used_by", { count: workflow.project_count }) : undefined
                  }
                  disabled={inUse}
                  onClick={() => setIsDeleteOpen(true)}
                />
              </MenuContent>
            </Menu>
          </div>
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

const COLUMNS = ["name", "preview", "projects", "updated"] as const;

export const WorkspaceWorkflowList = observer(function WorkspaceWorkflowList({
  workspaceSlug,
}: {
  workspaceSlug: string;
}) {
  const { t } = useTranslation();
  const { getWorkspaceWorkflows } = useWorkflow();
  const { allowPermissions } = useUserPermissions();
  const [query, setQuery] = useState("");
  const [usage, setUsage] = useState<TUsage>("all");
  // Display only: the server refuses every write from a non-admin.
  const canWrite = allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.WORKSPACE);
  const workflows = getWorkspaceWorkflows(workspaceSlug);
  const takenNames = workflows.map((workflow) => workflow.name);
  const columns = canWrite ? [...COLUMNS, "actions"] : COLUMNS;
  const needle = query.trim().toLowerCase();
  const visible = workflows.filter(
    (workflow) =>
      workflow.name.toLowerCase().includes(needle) &&
      (usage === "all" || (usage === "used") === workflow.project_count > 0)
  );

  if (workflows.length === 0)
    return <p className="text-body-sm-regular text-tertiary">{t("workflows.settings.empty")}</p>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="workflow-search" className="sr-only">
          {t("workflows.settings.search")}
        </label>
        <div className="flex h-9 w-72 max-w-full items-center gap-2 rounded-md border border-strong px-2.5">
          <SearchOutline className="size-4 shrink-0 text-tertiary" aria-hidden />
          <input
            id="workflow-search"
            type="search"
            value={query}
            placeholder={t("workflows.settings.search")}
            onChange={(event) => setQuery(event.target.value)}
            className="min-w-0 flex-1 bg-transparent text-body-sm-regular text-primary outline-none"
          />
        </div>
        <Menu>
          <MenuTrigger
            render={
              <Button
                variant="secondary"
                size="md"
                stretch="auto"
                aria-label={t("workflows.settings.usage.label")}
                label={`${t("workflows.settings.usage.label")} : ${t(`workflows.settings.usage.${usage}`)}`}
              />
            }
          />
          <MenuContent side="bottom" align="start">
            <MenuRadioGroup value={usage} onValueChange={(value) => setUsage(value as TUsage)}>
              {USAGES.map((item) => (
                <MenuRadioItem key={item} value={item} label={t(`workflows.settings.usage.${item}`)} />
              ))}
            </MenuRadioGroup>
          </MenuContent>
        </Menu>
        <span className="ml-auto text-caption-md-regular text-tertiary" aria-live="polite">
          {t("workflows.settings.count", { count: visible.length })}
        </span>
      </div>
      {visible.length === 0 ? (
        <p className="text-body-sm-regular text-tertiary">{t("workflows.settings.no_match")}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-subtle">
          <table className="w-full min-w-[900px] border-collapse" aria-label={t("workflows.label")}>
            <thead>
              <tr className="bg-layer-1 text-left text-body-xs-medium text-secondary">
                {columns.map((column) => (
                  <th key={column} scope="col" className={`px-4 py-2.5 ${column === "actions" ? "text-right" : ""}`}>
                    {t(`workflows.settings.columns.${column}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((workflow) => (
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
      )}
    </div>
  );
});
