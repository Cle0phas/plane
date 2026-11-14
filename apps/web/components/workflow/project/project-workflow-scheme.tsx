/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef, useState } from "react";
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
import {
  buildSchemePayload,
  getSchemeErrorKey,
  getSchemeNeeds,
  mergeArrivals,
  needKey,
  pendingNeeds,
  schemeRows,
} from "./scheme-helpers";

type Props = { workspaceSlug: string; projectId: string };

// Shown when a workflow or a type is unknown to the stores (deleted meanwhile, or not loaded yet).
const UNKNOWN = "-";

const SELECT_CLASS = "rounded-md border border-subtle bg-layer-1 px-2 py-1.5 text-body-sm-regular";

export const ProjectWorkflowScheme = observer(function ProjectWorkflowScheme({ workspaceSlug, projectId }: Props) {
  const { t } = useTranslation();
  const {
    fetchWorkflows,
    getWorkspaceWorkflows,
    getProjectScheme,
    fetchWorkflowDetail,
    getWorkflowDetail,
    previewProjectScheme,
    applyProjectScheme,
    detachProjectScheme,
  } = useWorkflow();
  const { getProjectAssignableTypes } = useWorkItemType();
  const { fetchProjectStates } = useProjectState();
  const scheme = getProjectScheme(projectId);
  const workflows = getWorkspaceWorkflows(workspaceSlug);
  const types = getProjectAssignableTypes(workspaceSlug, projectId);

  const [defaultWorkflowId, setDefaultWorkflowId] = useState("");
  const [typeChoices, setTypeChoices] = useState<Record<string, string>>({});
  const [needs, setNeeds] = useState<TWorkflowMappingNeed[] | null>(null);
  const [arrivals, setArrivals] = useState<Record<string, string>>({});
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [isDetachOpen, setIsDetachOpen] = useState(false);
  // The wizard only shows while linking or changing; a linked project shows its table.
  const [isEditing, setIsEditing] = useState(false);
  const { allowPermissions } = useUserPermissions();
  // Display only (A2, A4): the server refuses every write from anyone else.
  const isWorkspaceAdmin = allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.WORKSPACE, workspaceSlug);
  const canManage = allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.PROJECT, workspaceSlug, projectId);
  const rows = scheme ? schemeRows(scheme) : [];
  const isLinked = rows.length > 0;

  // A revalidated scheme must not overwrite what the user is editing.
  const isPristine = useRef(true);
  // Bumped after a successful apply or detach so the form re-reads the scheme whatever the render order.
  const [syncTick, setSyncTick] = useState(0);
  useEffect(() => {
    if (!isPristine.current || needs !== null) return;
    setDefaultWorkflowId(scheme?.default_workflow_id ?? "");
    setTypeChoices(Object.fromEntries((scheme?.items ?? []).map((item) => [item.issue_type_id, item.workflow_id])));
  }, [scheme, needs, syncTick]);

  const payload = (arrivalsOverride = arrivals) =>
    buildSchemePayload(
      defaultWorkflowId,
      typeChoices,
      arrivalsOverride,
      types.map((type) => type.id as string)
    );

  const refresh = () =>
    Promise.allSettled([fetchProjectStates(workspaceSlug, projectId), fetchWorkflows(workspaceSlug)]);

  const goToMapping = async () => {
    setErrorKey(null);
    setIsBusy(true);
    try {
      const chosen = new Set([defaultWorkflowId, ...Object.values(typeChoices).filter(Boolean)]);
      await Promise.all([...chosen].map((workflowId) => fetchWorkflowDetail(workspaceSlug, workflowId)));
      const pending = pendingNeeds(await previewProjectScheme(workspaceSlug, projectId, payload()));
      setArrivals((current) => mergeArrivals(current, pending));
      setNeeds(pending);
    } catch (error) {
      setErrorKey(getSchemeErrorKey(error));
    } finally {
      setIsBusy(false);
    }
  };

  const apply = async () => {
    setErrorKey(null);
    setIsBusy(true);
    try {
      await applyProjectScheme(workspaceSlug, projectId, payload());
      await refresh();
      isPristine.current = true;
      setSyncTick((tick) => tick + 1);
      setNeeds(null);
      setIsEditing(false);
      setToast({ type: "success", title: t("workflows.scheme.applied"), message: "" });
    } catch (error) {
      const refreshed = getSchemeNeeds(error);
      if (refreshed) {
        setNeeds(refreshed);
        setArrivals((current) => mergeArrivals(current, refreshed));
      }
      setErrorKey(getSchemeErrorKey(error));
    } finally {
      setIsBusy(false);
    }
  };

  const detach = async () => {
    setIsBusy(true);
    try {
      await detachProjectScheme(workspaceSlug, projectId);
      await refresh();
      isPristine.current = true;
      setSyncTick((tick) => tick + 1);
      setIsDetachOpen(false);
      setIsEditing(false);
      setToast({ type: "success", title: t("workflows.scheme.detached"), message: "" });
    } catch (error) {
      setIsDetachOpen(false);
      setErrorKey(getSchemeErrorKey(error));
    } finally {
      setIsBusy(false);
    }
  };

  const workflowName = (workflowId: string) => workflows.find((workflow) => workflow.id === workflowId)?.name ?? "";

  const startEditing = () => {
    setErrorKey(null);
    setIsEditing(true);
  };

  const cancelEditing = () => {
    isPristine.current = true;
    setSyncTick((tick) => tick + 1);
    setNeeds(null);
    setErrorKey(null);
    setIsEditing(false);
  };

  return (
    <div className="space-y-6">
      {!isLinked && !isEditing && (
        <div className="space-y-3">
          <p className="text-body-sm-regular text-secondary">{t("workflows.scheme.free")}</p>
          {canManage && (
            <Button
              variant="primary"
              size="md"
              stretch="auto"
              label={t("workflows.scheme.link")}
              onClick={startEditing}
            />
          )}
        </div>
      )}
      {isLinked && !isEditing && (
        <div className="space-y-3">
          {canManage && (
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                variant="secondary"
                size="md"
                stretch="auto"
                label={t("workflows.scheme.change")}
                onClick={startEditing}
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
                  {(isWorkspaceAdmin
                    ? (["workflow", "types", "actions"] as const)
                    : (["workflow", "types"] as const)
                  ).map((column) => (
                    <th key={column} scope="col" className="border-b border-subtle p-2">
                      {t(`workflows.scheme.table.${column}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const href = `/${workspaceSlug}/settings/workflows/${row.workflowId}`;
                  const name = workflowName(row.workflowId);
                  const unknownName = t("workflows.scheme.table.unknown_workflow");
                  const typeNames = row.typeIds.map(
                    (typeId) => types.find((type) => type.id === typeId)?.name ?? UNKNOWN
                  );
                  return (
                    <tr key={row.workflowId} className="align-top text-body-sm-regular text-primary">
                      <td className="border-b border-subtle p-2">
                        <Link
                          href={href}
                          className="text-body-sm-medium hover:underline"
                          aria-label={name ? undefined : unknownName}
                        >
                          {name || UNKNOWN}
                        </Link>
                      </td>
                      <td className="border-b border-subtle p-2 text-secondary">
                        {[...typeNames, ...(row.isDefault ? [t("workflows.scheme.other_types")] : [])].join(", ")}
                      </td>
                      {isWorkspaceAdmin && (
                        <td className="border-b border-subtle p-2">
                          <Link
                            href={href}
                            className="text-body-xs-medium text-accent-primary hover:underline"
                            aria-label={t("workflows.scheme.table.edit_named", { name: name || unknownName })}
                          >
                            {t("workflows.scheme.edit_workflow")}
                          </Link>
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
      {errorKey && (
        <p role="alert" className="text-body-sm-regular text-danger-primary">
          {t(errorKey)}
        </p>
      )}
      {isEditing &&
        canManage &&
        (needs === null ? (
          <div className="space-y-4">
            <label className="flex flex-col gap-1 text-body-xs-medium text-secondary">
              {t("workflows.scheme.default_workflow")}
              <select
                className={SELECT_CLASS}
                value={defaultWorkflowId}
                onChange={(event) => {
                  isPristine.current = false;
                  setDefaultWorkflowId(event.target.value);
                }}
              >
                <option value="" disabled>
                  {t("workflows.scheme.choose")}
                </option>
                {workflows.map((workflow) => (
                  <option key={workflow.id} value={workflow.id}>
                    {workflow.name}
                  </option>
                ))}
              </select>
            </label>
            {types.map((type) => (
              <label key={type.id} className="flex flex-col gap-1 text-body-xs-medium text-secondary">
                {t("workflows.scheme.per_type", { type: type.name })}
                <select
                  className={SELECT_CLASS}
                  value={typeChoices[type.id] ?? ""}
                  onChange={(event) => {
                    isPristine.current = false;
                    setTypeChoices((current) => ({ ...current, [type.id]: event.target.value }));
                  }}
                >
                  <option value="">{t("workflows.scheme.same_as_default")}</option>
                  {workflows.map((workflow) => (
                    <option key={workflow.id} value={workflow.id}>
                      {workflow.name}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <div className="flex gap-2">
              <Button
                variant="primary"
                size="md"
                stretch="auto"
                disabled={!defaultWorkflowId}
                loading={isBusy}
                label={t("workflows.scheme.next")}
                onClick={goToMapping}
              />
              <Button
                variant="secondary"
                size="md"
                stretch="auto"
                disabled={isBusy}
                label={t("workflows.settings.form.cancel")}
                onClick={cancelEditing}
              />
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <h3 className="text-body-md-medium text-primary">{t("workflows.scheme.mapping.title")}</h3>
            {needs.length === 0 ? (
              <p className="text-body-sm-regular text-secondary">{t("workflows.scheme.mapping.none")}</p>
            ) : (
              <>
                <p className="text-body-sm-regular text-secondary">{t("workflows.scheme.mapping.description")}</p>
                {needs.map((need) => (
                  <label key={needKey(need)} className="flex flex-col gap-1 text-body-xs-medium text-secondary">
                    {t("workflows.scheme.mapping.row", {
                      state: need.state_name,
                      workflow: workflowName(need.workflow_id),
                      count: need.issue_count,
                    })}
                    <select
                      className={SELECT_CLASS}
                      value={arrivals[needKey(need)] ?? ""}
                      onChange={(event) =>
                        setArrivals((current) => ({ ...current, [needKey(need)]: event.target.value }))
                      }
                    >
                      <option value="" disabled>
                        {t("workflows.scheme.mapping.pick")}
                      </option>
                      {(getWorkflowDetail(need.workflow_id)?.states ?? []).map((state) => (
                        <option key={state.status.id} value={state.status.id}>
                          {state.status.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </>
            )}
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="md"
                stretch="auto"
                label={t("workflows.scheme.back")}
                onClick={() => setNeeds(null)}
              />
              <Button
                variant="primary"
                size="md"
                stretch="auto"
                loading={isBusy}
                disabled={needs.some((need) => !arrivals[needKey(need)])}
                label={t("workflows.scheme.apply")}
                onClick={apply}
              />
            </div>
          </div>
        ))}
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
