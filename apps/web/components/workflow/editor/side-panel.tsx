/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef, useState } from "react";
import { observer } from "mobx-react";
import { Button } from "@makeplane/propel/components/button";
import { InputField } from "@makeplane/propel/components/input-field";
import { ChevronRightOutline, CloseOutline, PlusCircleOutline, WorkflowsOutline } from "@makeplane/propel/icons";
import { useTranslation } from "@plane/i18n";
import type { TStateGroups } from "@plane/types";
// local imports
import {
  removeSource,
  removeState,
  removeTransition,
  routeLabel,
  setInitial,
  setRestriction,
  stateName,
  transitionCounts,
  updateStatus,
  updateTransition,
  type TDraftGraph,
} from "./graph-model";
import { RestrictActorsForm } from "./restrict-actors-form";
import type { TEditorSelection } from "./workflow-canvas";

const GROUPS: TStateGroups[] = ["backlog", "unstarted", "started", "completed", "cancelled"];

type Props = {
  draft: TDraftGraph;
  // Always an element of the draft: the editor drops a selection whose element is gone.
  selection: TEditorSelection;
  canEdit: boolean;
  onChange: (draft: TDraftGraph) => void;
  onAddTransition: (preset: { sourceKey?: string; targetKey?: string }) => void;
  // Bumped when the selection comes from the text view, so keyboard users land in the panel.
  focusSignal: number;
};

export const WorkflowSidePanel = observer(function WorkflowSidePanel({
  draft,
  selection,
  canEdit,
  onChange,
  onAddTransition,
  focusSignal,
}: Props) {
  const { t } = useTranslation();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const handledSignal = useRef(0);

  // Any selection opens the panel (spec 3.7), a click on the element already selected too: each click
  // stores a new selection object, while a re-render keeps the same one.
  useEffect(() => {
    if (selection !== null) setIsCollapsed(false);
  }, [selection]);

  // A collapsed panel renders its heading only on the next pass, so the hand-off waits for it.
  useEffect(() => {
    if (focusSignal === handledSignal.current) return;
    if (isCollapsed) {
      setIsCollapsed(false);
      return;
    }
    handledSignal.current = focusSignal;
    headingRef.current?.focus();
  }, [focusSignal, isCollapsed]);

  const state = selection?.kind === "state" ? draft.states.find((item) => item.key === selection.key) : undefined;
  const transition =
    selection?.kind === "transition" ? draft.transitions.find((item) => item.key === selection.key) : undefined;
  const title = state ? "workflows.editor.panel.state" : "workflows.editor.panel.transition";
  const counts = state ? transitionCounts(draft, state.key) : null;

  const toggle = (
    <button
      type="button"
      className="flex size-8 shrink-0 items-center justify-center rounded-full border border-subtle bg-layer-1 max-md:size-11"
      aria-expanded={!isCollapsed}
      aria-label={t(isCollapsed ? "workflows.editor.panel.expand" : "workflows.editor.panel.collapse")}
      onClick={() => setIsCollapsed((value) => !value)}
    >
      <ChevronRightOutline className={`size-4 ${isCollapsed ? "rotate-180" : ""}`} aria-hidden />
    </button>
  );

  // Below 1024px the strip overlays the content like the open panel instead of taking its width.
  if (isCollapsed)
    return (
      <div className="border-l border-subtle bg-layer-2 p-2 max-lg:absolute max-lg:top-0 max-lg:right-0 max-lg:z-10">
        {toggle}
      </div>
    );

  return (
    <aside
      // Below 1024px the panel overlays the canvas, and only while something is selected (spec 3.8).
      className={`flex w-[400px] shrink-0 flex-col gap-4 overflow-y-auto border-l border-subtle bg-layer-2 p-4 max-lg:absolute max-lg:inset-y-0 max-lg:right-0 max-lg:z-10 max-lg:w-full max-lg:max-w-[400px] ${state || transition ? "" : "max-lg:hidden"}`}
      aria-label={t(state || transition ? title : "workflows.editor.panel.empty_title")}
    >
      <div className="flex items-start gap-2">
        {toggle}
        {(state || transition) && (
          <h2 ref={headingRef} tabIndex={-1} className="flex-1 text-h5-semibold text-primary">
            {t(title)}
          </h2>
        )}
      </div>

      {!state && !transition && (
        <div className="space-y-3 pt-8 text-center">
          <WorkflowsOutline className="mx-auto size-12 text-tertiary" aria-hidden />
          <h2 className="text-h5-semibold text-primary">{t("workflows.editor.panel.empty_title")}</h2>
          <p className="text-body-sm-regular text-secondary">{t("workflows.editor.panel.empty_body")}</p>
          <p className="text-body-sm-regular text-secondary">{t("workflows.editor.panel.empty_hint")}</p>
        </div>
      )}

      {state && counts && (
        <fieldset className="space-y-4" disabled={!canEdit}>
          {state.status.shared_count > 0 && (
            <p role="note" className="text-caption-sm-regular text-warning-primary">
              {t("workflows.editor.panel.shared", { count: state.status.shared_count })}
            </p>
          )}
          <InputField
            size="md"
            orientation="vertical"
            id="workflow-state-name"
            name="state-name"
            type="text"
            maxLength={255}
            label={t("workflows.editor.add_state.name")}
            value={state.status.name}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
              onChange(updateStatus(draft, state.key, { name: event.target.value }))
            }
          />
          <label className="flex flex-col gap-1 text-body-xs-medium text-secondary">
            {t("workflows.editor.add_state.group")}
            <select
              className="rounded-md border border-subtle bg-layer-1 px-2 py-1.5"
              value={state.status.group ?? ""}
              onChange={(event) =>
                onChange(updateStatus(draft, state.key, { group: (event.target.value || null) as TStateGroups | null }))
              }
            >
              {!state.status.group_locked && <option value="">{t("workflows.editor.add_state.group_auto")}</option>}
              {GROUPS.map((group) => (
                <option key={group} value={group}>
                  {t(`workflows.groups.${group}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-body-xs-medium text-secondary">
            {t("workflows.editor.panel.color")}
            <input
              type="color"
              value={state.status.color}
              onChange={(event) => onChange(updateStatus(draft, state.key, { color: event.target.value }))}
            />
          </label>
          <div className="space-y-2">
            <h3 className="text-body-sm-medium text-primary">{t("workflows.editor.text.transitions")}</h3>
            {(
              [
                ["incoming", counts.incoming, { targetKey: state.key }, "add_incoming"],
                ["outgoing", counts.outgoing, { sourceKey: state.key }, "add_outgoing"],
              ] as const
            ).map(([kind, count, preset, addKey]) => (
              <div key={kind} className="flex items-center gap-2 text-body-sm-regular text-secondary">
                <span className="flex-1">{t(`workflows.editor.panel.${kind}`)}</span>
                <span className="rounded-full bg-layer-1 px-2 text-caption-sm-medium">{count}</span>
                {canEdit && (
                  <button
                    type="button"
                    className="flex size-8 items-center justify-center rounded-md hover:bg-layer-1 max-md:size-11"
                    aria-label={t(`workflows.editor.panel.${addKey}`)}
                    onClick={() => onAddTransition(preset)}
                  >
                    <PlusCircleOutline className="size-4" aria-hidden />
                  </button>
                )}
              </div>
            ))}
          </div>
          {state.is_initial ? (
            <p className="text-body-xs-medium text-secondary">{t("workflows.editor.panel.initial")}</p>
          ) : (
            canEdit && (
              <Button
                variant="secondary"
                size="sm"
                stretch="auto"
                label={t("workflows.editor.panel.set_initial")}
                onClick={() => onChange(setInitial(draft, state.key))}
              />
            )
          )}
          {canEdit && (
            <Button
              variant="danger-outline"
              size="sm"
              stretch="auto"
              label={t("workflows.editor.panel.remove_state")}
              onClick={() => onChange(removeState(draft, state.key))}
            />
          )}
        </fieldset>
      )}

      {transition && (
        <div className="space-y-4">
          <fieldset className="space-y-3" disabled={!canEdit}>
            <InputField
              size="md"
              orientation="vertical"
              id="workflow-transition-name"
              name="transition-name"
              type="text"
              maxLength={255}
              label={t("workflows.editor.add_transition.name")}
              value={transition.name}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                onChange(updateTransition(draft, transition.key, { name: event.target.value }))
              }
            />
            <p className="text-body-sm-regular text-secondary">
              {routeLabel(
                transition.from_any
                  ? t("workflows.editor.global")
                  : transition.source_keys.map((key) => stateName(draft, key)).join(", "),
                stateName(draft, transition.target_key)
              )}
            </p>
            {/* The last source has no remove button: a transition from states needs one. */}
            {canEdit && !transition.from_any && transition.source_keys.length > 1 && (
              <ul className="flex flex-wrap gap-1">
                {transition.source_keys.map((key) => (
                  <li
                    key={key}
                    className="flex items-center gap-1 rounded-full bg-layer-1 py-0.5 pr-0.5 pl-2 text-caption-sm-medium text-secondary"
                  >
                    {stateName(draft, key)}
                    <button
                      type="button"
                      className="flex size-6 items-center justify-center rounded-full hover:bg-layer-1-hover max-md:size-11"
                      aria-label={t("workflows.editor.panel.remove_source", { name: stateName(draft, key) })}
                      onClick={() => onChange(removeSource(draft, transition.key, key))}
                    >
                      <CloseOutline className="size-3" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </fieldset>
          <RestrictActorsForm
            params={transition.rules[0]?.params ?? null}
            readOnly={!canEdit}
            onChange={(params) => onChange(setRestriction(draft, transition.key, params))}
          />
          {canEdit && (
            <Button
              variant="danger-outline"
              size="sm"
              stretch="auto"
              label={t("workflows.editor.panel.remove_transition")}
              onClick={() => onChange(removeTransition(draft, transition.key))}
            />
          )}
        </div>
      )}
    </aside>
  );
});
