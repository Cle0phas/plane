/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useMemo, useState } from "react";
import { observer } from "mobx-react";
import Link from "next/link";
import { Button } from "@makeplane/propel/components/button";
import { setToast } from "@plane/blocks/toast";
import { useTranslation } from "@plane/i18n";
import type { TWorkflowDetail, TWorkflowStatus, TWorkflowStatusUsage } from "@plane/types";
// hooks
import { useWorkflow } from "@/hooks/store/use-workflow";
// local imports
import { AddStateForm } from "./add-state-form";
import { AddTransitionForm } from "./add-transition-form";
import {
  addState,
  addTransition,
  fromDetail,
  getDraftErrorKey,
  getGraphErrorKey,
  isDraftDirty,
  moveState,
  toPayload,
  validateDraft,
  type TDraftGraph,
} from "./graph-model";
import { WorkflowSidePanel } from "./side-panel";
import { WorkflowCanvas, type TEditorSelection } from "./workflow-canvas";

type Props = {
  workspaceSlug: string;
  workflow: TWorkflowDetail;
  statuses: TWorkflowStatus[];
  readOnly: boolean;
};

export const WorkflowEditor = observer(function WorkflowEditor({ workspaceSlug, workflow, statuses, readOnly }: Props) {
  const { t } = useTranslation();
  const { saveGraph } = useWorkflow();
  const saved = useMemo(() => fromDetail(workflow, statuses), [workflow, statuses]);
  const [draft, setDraft] = useState<TDraftGraph>(saved);
  const [selection, setSelection] = useState<TEditorSelection>(null);
  const [serverError, setServerError] = useState<{ key: string; projects: TWorkflowStatusUsage[] } | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => setDraft(saved), [saved]);

  const errors = validateDraft(draft);
  const dirty = isDraftDirty(draft, saved);
  const usedStatusIds = new Set(draft.states.flatMap((state) => (state.status.id ? [state.status.id] : [])));

  const save = async () => {
    setServerError(null);
    setIsSaving(true);
    try {
      await saveGraph(workspaceSlug, workflow.id, toPayload(draft));
      setToast({ type: "success", title: t("workflows.editor.saved"), message: "" });
    } catch (error) {
      setServerError(getGraphErrorKey(error));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href={`/${workspaceSlug}/settings/workflows`}
          className="text-body-sm-regular text-secondary hover:underline"
        >
          {t("workflows.editor.back")}
        </Link>
        <h2 className="flex-1 text-h5-semibold text-primary">{workflow.name}</h2>
        {dirty && <span className="text-caption-sm-regular text-warning-primary">{t("workflows.editor.unsaved")}</span>}
        {!readOnly && (
          <>
            <Button
              variant="secondary"
              size="md"
              stretch="auto"
              disabled={!dirty || isSaving}
              label={t("workflows.editor.discard")}
              onClick={() => setDraft(saved)}
            />
            <Button
              variant="primary"
              size="md"
              stretch="auto"
              disabled={!dirty || errors.length > 0}
              loading={isSaving}
              label={t("workflows.editor.save")}
              onClick={save}
            />
          </>
        )}
      </div>
      {readOnly && <p className="text-body-sm-regular text-secondary">{t("workflows.editor.read_only")}</p>}
      {(errors.length > 0 || serverError) && (
        <div
          role="alert"
          className="rounded-md border border-danger-subtle bg-danger-subtle p-3 text-body-sm-regular text-danger-primary"
        >
          {errors.map((code) => (
            <p key={code}>{t(getDraftErrorKey(code))}</p>
          ))}
          {serverError && <p>{t(serverError.key)}</p>}
          {serverError?.projects.map((project) => (
            <p key={project.project_id}>
              {t("workflows.editor.errors.status_in_use_project", {
                project: project.project_name,
                count: project.issue_count,
              })}
            </p>
          ))}
        </div>
      )}
      <div className="flex gap-4">
        <div className="min-w-0 flex-1">
          <WorkflowCanvas
            draft={draft}
            readOnly={readOnly}
            selection={selection}
            onSelect={setSelection}
            onMove={(key, x, y) => setDraft((current) => moveState(current, key, x, y))}
            onConnect={(source, target) =>
              setDraft((current) =>
                addTransition(current, {
                  key: `new-${crypto.randomUUID()}`,
                  name: "",
                  from_any: false,
                  source_keys: [source],
                  target_key: target,
                  rules: [],
                })
              )
            }
          />
        </div>
        <WorkflowSidePanel
          draft={draft}
          selection={selection}
          readOnly={readOnly}
          onChange={setDraft}
          onClose={() => setSelection(null)}
        />
      </div>
      {!readOnly && (
        <div className="grid gap-6 md:grid-cols-2">
          <AddStateForm
            availableStatuses={statuses.filter((status) => !usedStatusIds.has(status.id))}
            onAdd={(status) => setDraft((current) => addState(current, `new-${crypto.randomUUID()}`, status))}
          />
          <AddTransitionForm
            draft={draft}
            onAdd={(transition) =>
              setDraft((current) => addTransition(current, { ...transition, key: `new-${crypto.randomUUID()}` }))
            }
          />
        </div>
      )}
    </div>
  );
});
