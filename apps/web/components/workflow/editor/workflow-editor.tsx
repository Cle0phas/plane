/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { observer } from "mobx-react";
import { setToast } from "@plane/blocks/toast";
import { useTranslation } from "@plane/i18n";
import { v4 as uuidv4 } from "uuid";
import type {
  TWorkflowDetail,
  TWorkflowGraphPayload,
  TWorkflowStatus,
  TWorkflowStatusCandidate,
  TWorkflowStatusUsage,
} from "@plane/types";
// local imports
import { AddRuleDialog } from "./add-rule-dialog";
import { AddStatusDialog } from "./add-status-dialog";
import { AddTransitionDialog, type TStateChoice, type TTransitionLock } from "./add-transition-dialog";
import { EditorHeader } from "./editor-header";
import { focusWhenReady } from "./focus-when-ready";
import {
  addStates,
  addTransitionWithStates,
  clearInitial,
  connectStates,
  errorTarget,
  fromDetail,
  getDraftErrorKey,
  getGraphErrorKey,
  isDraftDirty,
  moveState,
  optionToStatus,
  removeState,
  removeTransition,
  setInitial,
  setRestriction,
  shouldResetDraft,
  statusOptions,
  toPayload,
  validateDraft,
  type TDraftGraph,
  type TStateRef,
} from "./graph-model";
import { WorkflowSidePanel } from "./side-panel";
import { WorkflowTextView } from "./text-view";
import { WorkflowCanvas, type TEditorSelection } from "./workflow-canvas";

type Props = {
  workflow: TWorkflowDetail;
  statuses: TWorkflowStatus[];
  candidates: TWorkflowStatusCandidate[];
  readOnly: boolean;
  // Injected by the page (X10): the editor knows neither the store nor the router.
  onSave: (payload: TWorkflowGraphPayload) => Promise<TWorkflowDetail>;
  onClose: () => void;
};

type TDialog = { kind: "state" } | { kind: "transition"; lock: TTransitionLock | null } | { kind: "rule" } | null;

const VIEW_CLASS = "rounded-sm px-3 py-1 text-body-xs-medium max-md:min-h-11";

export const WorkflowEditor = observer(function WorkflowEditor(props: Props) {
  const { workflow, statuses, candidates, readOnly, onSave, onClose } = props;
  const { t } = useTranslation();
  // Read once (X13): below 768px the editor opens on the text view and does not edit.
  const [isSmall] = useState(() => window.matchMedia("(max-width: 767px)").matches);
  const canEdit = !readOnly && !isSmall;
  const saved = useMemo(() => fromDetail(workflow, statuses), [workflow, statuses]);
  const [draft, setDraft] = useState<TDraftGraph>(saved);
  const [picked, setSelection] = useState<TEditorSelection>(null);
  const [view, setView] = useState<"diagram" | "text">(isSmall ? "text" : "diagram");
  const [showLabels, setShowLabels] = useState(false);
  const [dialog, setDialog] = useState<TDialog>(null);
  const [serverError, setServerError] = useState<{ key: string; projects: TWorkflowStatusUsage[] } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [focusSignal, setFocusSignal] = useState(0);
  // Last state added through the dialog: its node or row takes the focus (spec 3.3).
  const [addedKey, setAddedKey] = useState<string | null>(null);
  const mainRef = useRef<HTMLElement>(null);
  const savedRef = useRef(saved);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  // The store refreshes the statuses before a save resolves: the save reads them here, not from its closure.
  const statusesRef = useRef(statuses);
  statusesRef.current = statuses;

  // A refresh (focus revalidation, status counts) must never wipe unsaved edits.
  useEffect(() => {
    const previous = savedRef.current;
    savedRef.current = saved;
    if (shouldResetDraft(previous, saved, draftRef.current)) setDraft(saved);
  }, [saved]);

  useEffect(() => {
    if (addedKey === null) return;
    return focusWhenReady(() =>
      Array.from(mainRef.current?.querySelectorAll<HTMLElement>(".react-flow__node, [data-state-key]") ?? []).find(
        (element) => (element.dataset.id ?? element.dataset.stateKey) === addedKey
      )
    );
  }, [addedKey]);

  // The one guard of the selection: once its element leaves the draft (removed, replaced on save) it is
  // dropped for good, so a discard that brings the element back does not reselect it.
  const isPickedInDraft =
    picked !== null &&
    (picked.kind === "start"
      ? true
      : (picked.kind === "state" ? draft.states : draft.transitions).some((item) => item.key === picked.key));
  if (picked !== null && !isPickedInDraft) setSelection(null);
  const selection = isPickedInDraft ? picked : null;
  const errors = validateDraft(draft);
  const dirty = isDraftDirty(draft, saved);
  const options = useMemo(
    () => statusOptions(statuses, candidates, draft, workflow.id),
    [statuses, candidates, draft, workflow.id]
  );
  const selectedTransitionKey = selection?.kind === "transition" ? selection.key : null;

  const save = async () => {
    setServerError(null);
    setIsSaving(true);
    try {
      const result = await onSave(toPayload(draft));
      setDraft(fromDetail(result, statusesRef.current));
      setToast({ type: "success", title: t("workflows.editor.saved"), message: "" });
    } catch (error) {
      setServerError(getGraphErrorKey(error));
    } finally {
      setIsSaving(false);
    }
  };

  const notice = readOnly ? "workflows.editor.read_only" : isSmall ? "workflows.editor.small_screen" : null;

  return (
    <div className="flex size-full flex-col bg-surface-1">
      <a href="#workflow-editor-main" className="sr-only focus:not-sr-only">
        {t(view === "diagram" ? "workflows.editor.diagram_label" : "workflows.editor.view.text")}
      </a>
      <EditorHeader
        name={workflow.name}
        projectCount={workflow.project_count}
        projects={workflow.projects}
        canEdit={canEdit}
        dirty={dirty}
        canSave={dirty && errors.length === 0}
        isSaving={isSaving}
        onAddState={() => setDialog({ kind: "state" })}
        onAddTransition={() => setDialog({ kind: "transition", lock: null })}
        onAddRule={() => setDialog({ kind: "rule" })}
        onSave={save}
        onDiscard={() => {
          setDraft(saved);
          setServerError(null);
        }}
        onClose={onClose}
      />
      {notice && (
        <p role="status" className="border-b border-subtle bg-layer-1 px-6 py-2 text-body-sm-regular text-secondary">
          {t(notice)}
        </p>
      )}
      {(errors.length > 0 || serverError) && (
        <div
          role="alert"
          className="space-y-1 border-b border-danger-subtle bg-danger-subtle px-6 py-2 text-body-sm-regular text-danger-primary"
        >
          {errors.length > 0 && (
            <ul>
              {errors.map((code) => {
                const target = errorTarget(draft, code);
                return (
                  <li key={code}>
                    {target ? (
                      <button type="button" className="text-left underline" onClick={() => setSelection(target)}>
                        {t(getDraftErrorKey(code))}
                      </button>
                    ) : (
                      t(getDraftErrorKey(code))
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {serverError && (
            <>
              <p>{t(serverError.key)}</p>
              {serverError.projects.map((project) => (
                <p key={project.project_id}>
                  {t("workflows.editor.errors.status_in_use_project", {
                    project: project.project_name,
                    count: project.issue_count,
                  })}
                </p>
              ))}
            </>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-4 px-6 py-3">
        <div
          role="group"
          aria-label={t("workflows.editor.view.label")}
          className="flex rounded-md border border-subtle p-0.5"
        >
          {(["diagram", "text"] as const).map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={view === item}
              className={`${VIEW_CLASS} ${view === item ? "bg-layer-1-selected text-primary" : "text-secondary"}`}
              onClick={() => setView(item)}
            >
              {t(`workflows.editor.view.${item}`)}
            </button>
          ))}
        </div>
        {view === "diagram" && (
          <label className="flex items-center gap-2 text-body-sm-regular text-secondary max-md:min-h-11">
            <input type="checkbox" checked={showLabels} onChange={(event) => setShowLabels(event.target.checked)} />
            {t("workflows.editor.show_labels")}
          </label>
        )}
      </div>
      <div className="relative flex min-h-0 flex-1">
        <main ref={mainRef} id="workflow-editor-main" tabIndex={-1} className="min-w-0 flex-1">
          {view === "diagram" ? (
            <WorkflowCanvas
              draft={draft}
              canEdit={canEdit}
              showLabels={showLabels}
              selection={selection}
              onSelect={setSelection}
              onMove={(moves) =>
                setDraft((current) => moves.reduce((acc, move) => moveState(acc, move.key, move.x, move.y), current))
              }
              onConnect={(source, sourceSide, target, targetSide) =>
                setDraft((current) => connectStates(current, `new-${uuidv4()}`, source, sourceSide, target, targetSide))
              }
              onSetInitial={(key) => setDraft((current) => setInitial(current, key))}
              onClearInitial={() => setDraft((current) => clearInitial(current))}
              onRemoveState={(key) => setDraft((current) => removeState(current, key))}
              onRemoveTransition={(key) => setDraft((current) => removeTransition(current, key))}
            />
          ) : (
            <WorkflowTextView
              draft={draft}
              selection={selection}
              onSelect={(next) => {
                setSelection(next);
                setFocusSignal((value) => value + 1);
              }}
            />
          )}
        </main>
        <WorkflowSidePanel
          draft={draft}
          selection={selection}
          canEdit={canEdit}
          onChange={setDraft}
          onAddTransition={(lock) => setDialog({ kind: "transition", lock })}
          focusSignal={focusSignal}
        />
      </div>
      <AddStatusDialog
        isOpen={dialog?.kind === "state"}
        draft={draft}
        options={options}
        onClose={() => setDialog(null)}
        onAdd={(chosen, allowAny) => {
          const entries = chosen.map((status) => ({
            key: `new-${uuidv4()}`,
            status,
            globalKey: allowAny ? `new-${uuidv4()}` : undefined,
          }));
          const lastKey = entries[entries.length - 1].key;
          setDraft((current) => addStates(current, entries));
          setSelection({ kind: "state", key: lastKey });
          setAddedKey(lastKey);
          setDialog(null);
        }}
      />
      <AddTransitionDialog
        isOpen={dialog?.kind === "transition"}
        draft={draft}
        options={options}
        lock={dialog?.kind === "transition" ? dialog.lock : null}
        onClose={() => setDialog(null)}
        onAdd={(choice) => {
          // Keys are made here, outside the state updater, so a replayed updater gives the same draft.
          const toRef = (item: TStateChoice): TStateRef =>
            item.kind === "state" ? item : { kind: "new", key: `new-${uuidv4()}`, status: optionToStatus(item.option) };
          const input = {
            key: `new-${uuidv4()}`,
            name: choice.name,
            from_any: choice.from_any,
            sources: choice.sources.map(toRef),
            target: toRef(choice.target),
          };
          setDraft((current) => addTransitionWithStates(current, input));
          setSelection({ kind: "transition", key: input.key });
          setDialog(null);
        }}
      />
      <AddRuleDialog
        isOpen={dialog?.kind === "rule"}
        draft={draft}
        presetKey={selectedTransitionKey}
        onClose={() => setDialog(null)}
        onApply={(transitionKey, params) => {
          setDraft((current) => setRestriction(current, transitionKey, params));
          setDialog(null);
        }}
      />
    </div>
  );
});
