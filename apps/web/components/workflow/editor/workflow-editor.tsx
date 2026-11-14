/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { observer } from "mobx-react";
import Link from "next/link";
import { Button } from "@makeplane/propel/components/button";
import { setToast } from "@plane/blocks/toast";
import { useTranslation } from "@plane/i18n";
import { v4 as uuidv4 } from "uuid";
import type { TWorkflowDetail, TWorkflowStatus, TWorkflowStatusUsage } from "@plane/types";
// hooks
import { useWorkflow } from "@/hooks/store/use-workflow";
// local imports
import { AddStateForm } from "./add-state-form";
import { AddTransitionForm } from "./add-transition-form";
import {
  addStates,
  addTransition,
  connectStates,
  fromDetail,
  getDraftErrorKey,
  getGraphErrorKey,
  isDraftDirty,
  moveState,
  removeState,
  removeTransition,
  setInitial,
  shouldResetDraft,
  toPayload,
  validateDraft,
  type TDraftGraph,
} from "./graph-model";
import { WorkflowSidePanel } from "./side-panel";
import { WorkflowElementList } from "./workflow-element-list";
import { WorkflowCanvas, type TEditorSelection } from "./workflow-canvas";

type Props = {
  workspaceSlug: string;
  workflow: TWorkflowDetail;
  statuses: TWorkflowStatus[];
  readOnly: boolean;
};

export const WorkflowEditor = observer(function WorkflowEditor({ workspaceSlug, workflow, statuses, readOnly }: Props) {
  const { t } = useTranslation();
  const { saveGraph, getWorkspaceStatuses } = useWorkflow();
  const saved = useMemo(() => fromDetail(workflow, statuses), [workflow, statuses]);
  const [draft, setDraft] = useState<TDraftGraph>(saved);
  const [selection, setSelection] = useState<TEditorSelection>(null);
  const [serverError, setServerError] = useState<{ key: string; projects: TWorkflowStatusUsage[] } | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const [focusSignal, setFocusSignal] = useState(0);
  const [returnSignal, setReturnSignal] = useState(0);
  const triggerRef = useRef<HTMLElement | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const savedRef = useRef(saved);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  // A refresh (focus revalidation, status counts) must never wipe unsaved edits.
  useEffect(() => {
    const previous = savedRef.current;
    savedRef.current = saved;
    if (shouldResetDraft(previous, saved, draftRef.current)) setDraft(saved);
  }, [saved]);

  // Back to the button that opened the panel, or to the list when that element is gone (removed).
  useEffect(() => {
    if (returnSignal === 0) return;
    const trigger = triggerRef.current;
    (trigger?.isConnected ? trigger : listRef.current)?.focus();
  }, [returnSignal]);

  const closePanel = () => {
    setSelection(null);
    setReturnSignal((value) => value + 1);
  };

  const errors = validateDraft(draft);
  const dirty = isDraftDirty(draft, saved);
  const usedStatusIds = new Set(draft.states.flatMap((state) => (state.status.id ? [state.status.id] : [])));

  const save = async () => {
    setServerError(null);
    setIsSaving(true);
    try {
      const result = await saveGraph(workspaceSlug, workflow.id, toPayload(draft));
      setDraft(fromDetail(result, getWorkspaceStatuses(workspaceSlug)));
      setSelection(null);
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
        <div className="space-y-2 rounded-md border border-danger-subtle bg-danger-subtle p-3 text-body-sm-regular text-danger-primary">
          <div aria-live="polite">
            {errors.map((code) => (
              <p key={code}>{t(getDraftErrorKey(code))}</p>
            ))}
          </div>
          {serverError && (
            <div role="alert">
              <p>{t(serverError.key)}</p>
              {serverError.projects.map((project) => (
                <p key={project.project_id}>
                  {t("workflows.editor.errors.status_in_use_project", {
                    project: project.project_name,
                    count: project.issue_count,
                  })}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="flex gap-4">
        <div className="h-[560px] min-w-0 flex-1 rounded-md border border-subtle">
          <WorkflowCanvas
            draft={draft}
            canEdit={!readOnly}
            showLabels
            selection={selection}
            onSelect={setSelection}
            onMove={(moves) =>
              setDraft((current) => moves.reduce((acc, move) => moveState(acc, move.key, move.x, move.y), current))
            }
            onConnect={(source, sourceSide, target, targetSide) =>
              setDraft((current) => connectStates(current, `new-${uuidv4()}`, source, sourceSide, target, targetSide))
            }
            onSetInitial={(key) => setDraft((current) => setInitial(current, key))}
            onRemoveState={(key) => setDraft((current) => removeState(current, key))}
            onRemoveTransition={(key) => setDraft((current) => removeTransition(current, key))}
          />
        </div>
        <WorkflowSidePanel
          draft={draft}
          selection={selection}
          readOnly={readOnly}
          onChange={setDraft}
          onClose={closePanel}
          focusSignal={focusSignal}
        />
      </div>
      <WorkflowElementList
        draft={draft}
        selection={selection}
        containerRef={listRef}
        onOpen={(next, trigger) => {
          triggerRef.current = trigger;
          setSelection(next);
          setFocusSignal((value) => value + 1);
        }}
      />
      {!readOnly && (
        <div className="grid gap-6 md:grid-cols-2">
          <AddStateForm
            availableStatuses={statuses.filter((status) => !usedStatusIds.has(status.id))}
            onAdd={(status) => setDraft((current) => addStates(current, [{ key: `new-${uuidv4()}`, status }]))}
          />
          <AddTransitionForm
            draft={draft}
            onAdd={(transition) =>
              setDraft((current) => addTransition(current, { ...transition, key: `new-${uuidv4()}` }))
            }
          />
        </div>
      )}
    </div>
  );
});
