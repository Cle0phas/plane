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
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import type { TWorkflowMappingNeed } from "@plane/types";
// hooks
import { useProjectState } from "@/hooks/store/use-project-state";
import { useWorkItemType } from "@/hooks/store/use-work-item-type";
import { useWorkflow } from "@/hooks/store/use-workflow";
import { useUserPermissions } from "@/hooks/store/user";
// local imports
import { SchemeFormDialog, SchemeMappingDialog, type TSchemeFormProps } from "./scheme-dialog";
import {
  buildSchemePayload,
  freeTypeIds,
  getSchemeErrorKey,
  getSchemeNeeds,
  mergeArrivals,
  pendingNeeds,
  schemeChoice,
  schemeRows,
  unusedWorkflowIds,
  withDefault,
  withWorkflowTypes,
  withoutWorkflow,
  type TSchemeChoice,
} from "./scheme-helpers";

type Props = { workspaceSlug: string; projectId: string };

type TAction =
  | { kind: "link" }
  | { kind: "add" }
  | { kind: "replace" }
  | { kind: "types"; workflowId: string }
  | { kind: "remove"; workflowId: string };
type TForm = Pick<
  TSchemeFormProps,
  "title" | "submitLabel" | "workflows" | "isWorkflowFixed" | "types" | "checkedTypeIds" | "notes" | "onSubmit"
>;

// Shown for a type unknown to the store (deleted meanwhile, or not loaded yet).
const UNKNOWN = "-";
const ACTION_CLASS = "rounded-sm text-body-xs-medium text-accent-primary hover:underline max-md:min-h-11";
const CELL_CLASS = "border-b border-subtle p-2";

export const ProjectWorkflowScheme = observer(function ProjectWorkflowScheme({ workspaceSlug, projectId }: Props) {
  const { t, currentLocale } = useTranslation();
  const {
    fetchWorkflows,
    getWorkspaceWorkflows,
    getProjectScheme,
    fetchProjectScheme,
    fetchWorkflowDetail,
    getWorkflowDetail,
    previewProjectScheme,
    applyProjectScheme,
    detachProjectScheme,
  } = useWorkflow();
  const { getProjectAssignableTypes } = useWorkItemType();
  const { fetchProjectStates } = useProjectState();
  const { allowPermissions } = useUserPermissions();
  // Display only (A4): the server refuses every write from anyone else.
  const canManage = allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.PROJECT, workspaceSlug, projectId);
  const scheme = getProjectScheme(projectId);
  const workflows = getWorkspaceWorkflows(workspaceSlug);
  const types = getProjectAssignableTypes(workspaceSlug, projectId).map((type) => ({
    id: type.id as string,
    name: type.name as string,
  }));

  const [action, setAction] = useState<TAction | null>(null);
  const [mapping, setMapping] = useState<{ choice: TSchemeChoice; needs: TWorkflowMappingNeed[] } | null>(null);
  const [arrivals, setArrivals] = useState<Record<string, string>>({});
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [isDetachOpen, setIsDetachOpen] = useState(false);

  const rows = scheme ? schemeRows(scheme) : [];
  const choice = schemeChoice(scheme ?? { default_workflow_id: null, items: [] });
  const typeIds = types.map((type) => type.id);
  const names = new Intl.ListFormat(currentLocale, { style: "short", type: "unit" });
  const workflowName = (id: string) =>
    workflows.find((workflow) => workflow.id === id)?.name ?? t("workflows.scheme.table.unknown_workflow");
  const typeNames = (ids: string[]) =>
    names.format(ids.map((id) => types.find((type) => type.id === id)?.name ?? UNKNOWN));
  const toNamed = (id: string) => ({ id, name: workflowName(id) });
  const unused = unusedWorkflowIds(
    choice,
    workflows.map((workflow) => workflow.id)
  ).map(toNamed);
  const typesFor = (ownWorkflowId?: string) => {
    const free = freeTypeIds(choice, typeIds, ownWorkflowId);
    return types.filter((type) => free.includes(type.id));
  };
  // Why a type is missing from the list: it already follows another workflow of the table.
  const takenNotes = (exceptWorkflowId?: string) =>
    rows
      .filter((row) => !row.isDefault && row.typeIds.length > 0 && row.workflowId !== exceptWorkflowId)
      .map((row) =>
        t("workflows.scheme.taken_note", {
          count: row.typeIds.length,
          types: typeNames(row.typeIds),
          workflow: workflowName(row.workflowId),
        })
      );
  const addBlocker =
    unused.length === 0 ? "workflows.scheme.no_workflow" : typesFor().length === 0 ? "workflows.scheme.no_type" : null;

  const start = (next: TAction) => {
    setErrorKey(null);
    setAction(next);
  };
  const close = () => {
    setAction(null);
    setMapping(null);
    setArrivals({});
    setErrorKey(null);
  };

  const applyChoice = async (next: TSchemeChoice, chosen: Record<string, string>) => {
    await applyProjectScheme(
      workspaceSlug,
      projectId,
      buildSchemePayload(next.defaultWorkflowId, next.items, chosen, typeIds)
    );
    await Promise.allSettled([fetchProjectStates(workspaceSlug, projectId), fetchWorkflows(workspaceSlug)]);
    close();
    setToast({ type: "success", title: t("workflows.scheme.applied"), message: "" });
  };

  // Every change starts from the scheme the server holds now, not from the copy on screen (Y12), and
  // is applied at once unless work items must change state (W10).
  const run = async (change: (current: TSchemeChoice) => TSchemeChoice) => {
    setErrorKey(null);
    setIsBusy(true);
    try {
      const next = change(schemeChoice(await fetchProjectScheme(workspaceSlug, projectId)));
      const payload = buildSchemePayload(next.defaultWorkflowId, next.items, {}, typeIds);
      const needs = pendingNeeds(await previewProjectScheme(workspaceSlug, projectId, payload));
      if (needs.length === 0) return await applyChoice(next, {});
      const involved = [...new Set(needs.map((need) => need.workflow_id))];
      await Promise.all(involved.map((workflowId) => fetchWorkflowDetail(workspaceSlug, workflowId)));
      setArrivals({});
      setMapping({ choice: next, needs });
    } catch (error) {
      // A confirmation has no room for a message: it closes and the page shows the refusal.
      if (action?.kind === "remove") setAction(null);
      setErrorKey(getSchemeErrorKey(error));
    } finally {
      setIsBusy(false);
    }
  };

  const applyMapping = async () => {
    if (!mapping) return;
    setErrorKey(null);
    setIsBusy(true);
    try {
      await applyChoice(mapping.choice, arrivals);
    } catch (error) {
      const refreshed = getSchemeNeeds(error);
      if (refreshed) {
        setMapping({ choice: mapping.choice, needs: refreshed });
        setArrivals((current) => mergeArrivals(current, refreshed));
      }
      setErrorKey(getSchemeErrorKey(error));
    } finally {
      setIsBusy(false);
    }
  };

  const detach = async () => {
    setErrorKey(null);
    setIsBusy(true);
    try {
      await detachProjectScheme(workspaceSlug, projectId);
      await Promise.allSettled([fetchProjectStates(workspaceSlug, projectId), fetchWorkflows(workspaceSlug)]);
      setToast({ type: "success", title: t("workflows.scheme.detached"), message: "" });
    } catch (error) {
      setErrorKey(getSchemeErrorKey(error));
    } finally {
      setIsDetachOpen(false);
      setIsBusy(false);
    }
  };

  const formOf = (current: TAction | null): TForm | null => {
    if (current?.kind === "link")
      return {
        title: t("workflows.scheme.link"),
        submitLabel: t("workflows.scheme.link_submit"),
        workflows: workflows.map((workflow) => toNamed(workflow.id)),
        notes: [t("workflows.scheme.link_note")],
        onSubmit: (workflowId) => void run(() => ({ defaultWorkflowId: workflowId, items: {} })),
      };
    if (current?.kind === "add")
      return {
        title: t("workflows.scheme.add"),
        submitLabel: t("workflows.scheme.add_submit"),
        workflows: unused,
        types: typesFor(),
        notes: [...takenNotes(), t("workflows.scheme.unchecked_note")],
        onSubmit: (workflowId, ids) => void run((latest) => withWorkflowTypes(latest, workflowId, ids)),
      };
    if (current?.kind === "types")
      return {
        title: t("workflows.scheme.edit_types_named", { name: workflowName(current.workflowId) }),
        submitLabel: t("workflows.scheme.apply"),
        workflows: [toNamed(current.workflowId)],
        isWorkflowFixed: true,
        types: typesFor(current.workflowId),
        checkedTypeIds: rows.find((row) => row.workflowId === current.workflowId)?.typeIds ?? [],
        notes: [...takenNotes(current.workflowId), t("workflows.scheme.unchecked_note")],
        onSubmit: (workflowId, ids) => void run((latest) => withWorkflowTypes(latest, workflowId, ids)),
      };
    if (current?.kind === "replace")
      return {
        title: t("workflows.scheme.replace_title"),
        submitLabel: t("workflows.scheme.replace"),
        workflows: unused,
        notes: [t("workflows.scheme.link_note")],
        onSubmit: (workflowId) => void run((latest) => withDefault(latest, workflowId)),
      };
    return null;
  };
  const form = formOf(action);
  const removed = action?.kind === "remove" ? rows.find((row) => row.workflowId === action.workflowId) : undefined;
  const isDialogOpen = action !== null || mapping !== null;

  return (
    <div className="space-y-6">
      {rows.length === 0 ? (
        <div className="space-y-3">
          <p className="text-body-sm-regular text-secondary">{t("workflows.scheme.free")}</p>
          {canManage && (
            <Button
              variant="primary"
              size="md"
              stretch="auto"
              label={t("workflows.scheme.link")}
              onClick={() => start({ kind: "link" })}
            />
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {canManage && (
            <div className="flex flex-wrap items-center justify-end gap-2">
              {addBlocker && <p className="text-caption-sm-regular text-tertiary">{t(addBlocker)}</p>}
              <Button
                variant="secondary"
                size="md"
                stretch="auto"
                disabled={addBlocker !== null}
                label={t("workflows.scheme.add")}
                onClick={() => start({ kind: "add" })}
              />
              <Button
                variant="danger-outline"
                size="md"
                stretch="auto"
                label={t("workflows.scheme.detach")}
                onClick={() => setIsDetachOpen(true)}
              />
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-separate border-spacing-0" aria-label={t("workflows.label")}>
              <thead>
                <tr className="text-left text-body-xs-medium text-secondary">
                  {(canManage ? (["workflow", "types", "actions"] as const) : (["workflow", "types"] as const)).map(
                    (column) => (
                      <th key={column} scope="col" className={CELL_CLASS}>
                        {t(`workflows.scheme.table.${column}`)}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const name = workflowName(row.workflowId);
                  return (
                    <tr key={row.workflowId} className="align-top text-body-sm-regular text-primary">
                      <td className={CELL_CLASS}>
                        <Link
                          href={`/${workspaceSlug}/settings/workflows/${row.workflowId}`}
                          className="text-body-sm-medium hover:underline"
                        >
                          {name}
                        </Link>
                        {row.isDefault && (
                          <span className="ml-2 rounded-sm border border-subtle px-1.5 py-0.5 text-caption-sm-medium text-secondary">
                            {t("workflows.scheme.default_badge")}
                          </span>
                        )}
                      </td>
                      <td className={`${CELL_CLASS} text-secondary`}>
                        {row.isDefault ? t("workflows.scheme.other_types") : typeNames(row.typeIds)}
                      </td>
                      {canManage && (
                        <td className={CELL_CLASS}>
                          {row.isDefault ? (
                            <button
                              type="button"
                              className={ACTION_CLASS}
                              disabled={unused.length === 0}
                              onClick={() => start({ kind: "replace" })}
                            >
                              {t("workflows.scheme.replace")}
                            </button>
                          ) : (
                            <span className="flex flex-wrap gap-3">
                              <button
                                type="button"
                                className={ACTION_CLASS}
                                aria-label={t("workflows.scheme.edit_types_named", { name })}
                                onClick={() => start({ kind: "types", workflowId: row.workflowId })}
                              >
                                {t("workflows.scheme.edit_types")}
                              </button>
                              <button
                                type="button"
                                className={ACTION_CLASS}
                                aria-label={t("workflows.scheme.remove_named", { name })}
                                onClick={() => start({ kind: "remove", workflowId: row.workflowId })}
                              >
                                {t("workflows.scheme.remove")}
                              </button>
                            </span>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {errorKey && !isDialogOpen && (
        <p role="alert" className="text-body-sm-regular text-danger-primary">
          {t(errorKey)}
        </p>
      )}
      {form && (
        <SchemeFormDialog {...form} isOpen={mapping === null} isBusy={isBusy} errorKey={errorKey} onClose={close} />
      )}
      <SchemeMappingDialog
        isOpen={mapping !== null}
        needs={mapping?.needs ?? []}
        arrivals={arrivals}
        statesOf={(workflowId) =>
          (getWorkflowDetail(workflowId)?.states ?? []).map((state) => ({
            id: state.status.id,
            name: state.status.name,
          }))
        }
        workflowName={workflowName}
        isBusy={isBusy}
        errorKey={errorKey}
        onArrival={(key, statusId) => setArrivals((current) => ({ ...current, [key]: statusId }))}
        onApply={() => void applyMapping()}
        onClose={close}
      />
      <ConfirmDialog
        isOpen={removed !== undefined && mapping === null}
        handleClose={close}
        handleSubmit={() => (removed ? run((latest) => withoutWorkflow(latest, removed.workflowId)) : undefined)}
        isSubmitting={isBusy}
        title={t("workflows.scheme.remove_title", { name: removed ? workflowName(removed.workflowId) : "" })}
        content={t("workflows.scheme.remove_confirm", {
          count: removed?.typeIds.length ?? 0,
          types: typeNames(removed?.typeIds ?? []),
          default: workflowName(choice.defaultWorkflowId),
        })}
        primaryButtonText={{ loading: t("workflows.scheme.remove"), default: t("workflows.scheme.remove") }}
      />
      <ConfirmDialog
        handleClose={() => setIsDetachOpen(false)}
        handleSubmit={detach}
        isSubmitting={isBusy}
        isOpen={isDetachOpen}
        title={t("workflows.scheme.detach")}
        content={t("workflows.scheme.detach_confirm")}
        primaryButtonText={{ loading: t("workflows.scheme.detach"), default: t("workflows.scheme.detach") }}
      />
    </div>
  );
});
