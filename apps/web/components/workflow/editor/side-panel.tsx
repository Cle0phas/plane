/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef, useState } from "react";
import { observer } from "mobx-react";
import { Button } from "@makeplane/propel/components/button";
import { InputField } from "@makeplane/propel/components/input-field";
import { ChevronRightOutline, CloseOutline, WorkflowsOutline } from "@makeplane/propel/icons";
import { useTranslation } from "@plane/i18n";
import type { TStateGroups, TWorkflowRestrictActorsParams } from "@plane/types";
// local imports
import type { TTransitionLock } from "./add-transition-dialog";
import {
  displayGroup,
  removeSource,
  removeState,
  removeTransition,
  routeLabel,
  setInitial,
  setRestriction,
  sourceCandidates,
  stateName,
  toneOf,
  updateStatus,
  updateTransition,
  type TDraftGraph,
  type TDraftTransition,
} from "./graph-model";
import { StartPanel } from "./start-panel";
import { TONE_CLASS } from "./tones";
import type { TEditorSelection } from "./workflow-canvas";

const GROUPS: TStateGroups[] = ["backlog", "unstarted", "started", "completed", "cancelled"];
const ROLE_KEYS: Record<number, string> = { 20: "admin", 15: "member", 5: "guest" };
// Beyond five names the note says how many more there are (spec 4.5).
const MAX_NAMES = 5;
const FIELD_CLASS = "rounded-md border border-subtle bg-layer-1 px-2 py-1.5 text-body-sm-regular max-md:min-h-11";
const LABEL_CLASS = "flex flex-col gap-1 text-body-xs-medium text-secondary";
const LINK_CLASS = "rounded-sm text-body-xs-medium text-accent-primary hover:underline max-md:min-h-11";
const CARD_CLASS =
  "w-full rounded-md border border-subtle bg-layer-1 p-2 text-left hover:bg-layer-1-hover max-md:min-h-11";
const CHIP_CLASS = "inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-caption-sm-medium uppercase";
const SECTION_TITLE_CLASS = "text-body-sm-medium text-primary";
const FOOT_CLASS = "mt-auto space-y-2 border-t border-subtle pt-4";

type Props = {
  draft: TDraftGraph;
  // Always an element of the draft: the editor drops a selection whose element is gone.
  selection: TEditorSelection;
  canEdit: boolean;
  onChange: (draft: TDraftGraph) => void;
  onSelect: (selection: TEditorSelection) => void;
  onAddTransition: (lock: TTransitionLock) => void;
  /** Opens the rule dialog on the selected transition. */
  onEditRule: () => void;
  // Bumped when the selection comes from the text view, so keyboard users land in the panel.
  focusSignal: number;
};

export const WorkflowSidePanel = observer(function WorkflowSidePanel(props: Props) {
  const { draft, selection, canEdit, onChange, onSelect, onAddTransition, onEditRule, focusSignal } = props;
  const { t, currentLocale } = useTranslation();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isAddingSource, setIsAddingSource] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const sourcePickerRef = useRef<HTMLSelectElement>(null);
  const handledSignal = useRef(0);

  // Any selection opens the panel (spec 3.7), a click on the element already selected too: each click
  // stores a new selection object, while a re-render keeps the same one.
  useEffect(() => {
    if (selection !== null) setIsCollapsed(false);
    setIsAddingSource(false);
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

  // The link that opened the picker is gone: the picker takes the focus.
  useEffect(() => {
    if (isAddingSource) sourcePickerRef.current?.focus();
  }, [isAddingSource]);

  const state = selection?.kind === "state" ? draft.states.find((item) => item.key === selection.key) : undefined;
  const transition =
    selection?.kind === "transition" ? draft.transitions.find((item) => item.key === selection.key) : undefined;
  const isStart = selection?.kind === "start";
  const hasSelection = Boolean(state || transition || isStart);
  const unnamed = t("workflows.editor.text.unnamed");
  const names = new Intl.ListFormat(currentLocale, { style: "short", type: "unit" });

  const toneClassOf = (key: string) => {
    const found = draft.states.find((item) => item.key === key);
    return TONE_CLASS[toneOf(found ? displayGroup(draft, found) : "unstarted")];
  };
  const routeOf = (item: TDraftTransition) =>
    routeLabel(
      item.from_any ? t("workflows.editor.global") : item.source_keys.map((key) => stateName(draft, key)).join(", "),
      stateName(draft, item.target_key)
    );
  const sharedNote = (shared: string[]) => {
    const shown = names.format(shared.slice(0, MAX_NAMES));
    const list =
      shared.length > MAX_NAMES
        ? t("workflows.editor.panel.more_names", { names: shown, count: shared.length - MAX_NAMES })
        : shown;
    return t("workflows.editor.panel.shared_named", { count: shared.length, names: list });
  };
  const ruleSummary = (params: TWorkflowRestrictActorsParams) =>
    [
      params.roles?.length
        ? t("workflows.editor.restrict.summary_roles", {
            roles: names.format(params.roles.map((role) => t(`workflows.roles.${ROLE_KEYS[role]}`))),
          })
        : null,
      params.user_ids?.length ? t("workflows.editor.restrict.summary_users", { count: params.user_ids.length }) : null,
      params.assignee ? t("workflows.editor.restrict.assignee") : null,
      params.creator ? t("workflows.editor.restrict.creator") : null,
    ]
      .filter(Boolean)
      .join(" · ");

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

  const transitionSection = (kind: "incoming" | "outgoing", items: TDraftTransition[], lock: TTransitionLock) => (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <h3 className={`flex-1 ${SECTION_TITLE_CLASS}`}>
          {t(`workflows.editor.panel.${kind}_count`, { count: items.length })}
        </h3>
        {canEdit && (
          <button
            type="button"
            className={LINK_CLASS}
            aria-label={t(`workflows.editor.panel.add_${kind}`)}
            onClick={() => onAddTransition(lock)}
          >
            {t("workflows.editor.panel.add")}
          </button>
        )}
      </div>
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item.key}>
            <button
              type="button"
              className={CARD_CLASS}
              onClick={() => onSelect({ kind: "transition", key: item.key })}
            >
              <span className="block text-body-sm-medium text-primary">{item.name || unnamed}</span>
              <span className="block text-caption-sm-regular text-secondary">{routeOf(item)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );

  const rule = transition?.rules[0];
  const candidates = transition ? sourceCandidates(draft, transition.key) : [];
  const title = isStart
    ? t("workflows.editor.start_panel.title")
    : state
      ? state.status.name
      : transition
        ? transition.name || unnamed
        : t("workflows.editor.panel.empty_title");

  return (
    <aside
      // Below 1024px the panel overlays the canvas, and only while something is selected (spec 3.8).
      className={`flex w-[400px] shrink-0 flex-col gap-4 overflow-y-auto border-l border-subtle bg-layer-2 p-4 max-lg:absolute max-lg:inset-y-0 max-lg:right-0 max-lg:z-10 max-lg:w-full max-lg:max-w-[400px] ${hasSelection ? "" : "max-lg:hidden"}`}
      aria-label={title}
    >
      <div className="flex items-start gap-2">
        {toggle}
        {hasSelection && (
          <div className="min-w-0 flex-1">
            {transition && (
              <p className="text-caption-sm-medium text-tertiary">{t("workflows.editor.panel.transition")}</p>
            )}
            <h2 ref={headingRef} tabIndex={-1} className="flex items-center gap-2 text-h5-semibold text-primary">
              {state && (
                <span className={`size-3 shrink-0 rounded-full border ${toneClassOf(state.key)}`} aria-hidden />
              )}
              <span className="truncate">{title}</span>
            </h2>
          </div>
        )}
      </div>

      {!hasSelection && (
        <div className="space-y-3 pt-8 text-center">
          <WorkflowsOutline className="mx-auto size-12 text-tertiary" aria-hidden />
          <h2 className="text-h5-semibold text-primary">{t("workflows.editor.panel.empty_title")}</h2>
          <p className="text-body-sm-regular text-secondary">{t("workflows.editor.panel.empty_body")}</p>
          <p className="text-body-sm-regular text-secondary">{t("workflows.editor.panel.empty_hint")}</p>
        </div>
      )}

      {isStart && <StartPanel draft={draft} canEdit={canEdit} onChange={onChange} />}

      {state && (
        <>
          <fieldset className="space-y-4" disabled={!canEdit}>
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
            <div className="grid grid-cols-2 gap-3">
              <label className={LABEL_CLASS}>
                {t("workflows.editor.add_state.group")}
                <select
                  className={FIELD_CLASS}
                  value={state.status.group ?? ""}
                  onChange={(event) =>
                    onChange(
                      updateStatus(draft, state.key, { group: (event.target.value || null) as TStateGroups | null })
                    )
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
              <label className={LABEL_CLASS}>
                {t("workflows.editor.panel.color")}
                <span className="flex items-center gap-2">
                  <input
                    type="color"
                    value={state.status.color}
                    onChange={(event) => onChange(updateStatus(draft, state.key, { color: event.target.value }))}
                  />
                  <span className="text-body-sm-regular text-primary uppercase">{state.status.color}</span>
                </span>
              </label>
            </div>
          </fieldset>
          {canEdit && (state.status.shared_names?.length ?? 0) > 0 && (
            <p
              role="note"
              className="rounded-md border border-warning-subtle bg-warning-subtle p-2 text-caption-sm-regular text-warning-primary"
            >
              {sharedNote(state.status.shared_names ?? [])}
            </p>
          )}
          {transitionSection(
            "incoming",
            draft.transitions.filter((item) => item.target_key === state.key),
            { side: "target", key: state.key }
          )}
          {transitionSection(
            "outgoing",
            draft.transitions.filter((item) => !item.from_any && item.source_keys.includes(state.key)),
            { side: "source", key: state.key }
          )}
          {(canEdit || state.is_initial) && (
            <div className={canEdit ? FOOT_CLASS : "mt-auto"}>
              {state.is_initial ? (
                <p className="text-body-xs-medium text-secondary">{t("workflows.editor.panel.initial")}</p>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  stretch="auto"
                  label={t("workflows.editor.panel.set_initial")}
                  onClick={() => onChange(setInitial(draft, state.key))}
                />
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
            </div>
          )}
        </>
      )}

      {transition && (
        <>
          <fieldset disabled={!canEdit}>
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
          </fieldset>
          <section className="space-y-2">
            <h3 className={SECTION_TITLE_CLASS}>{t("workflows.editor.panel.path")}</h3>
            <div role="group" aria-label={routeOf(transition)} className="flex flex-wrap items-center gap-1">
              {transition.from_any ? (
                <span className={`${CHIP_CLASS} border-subtle text-secondary`}>{t("workflows.editor.global")}</span>
              ) : (
                transition.source_keys.map((key) => (
                  <span key={key} className={`${CHIP_CLASS} ${toneClassOf(key)}`}>
                    {stateName(draft, key)}
                    {/* The last source has no remove button: a transition from states needs one. */}
                    {canEdit && transition.source_keys.length > 1 && (
                      <button
                        type="button"
                        className="flex size-5 items-center justify-center rounded-full hover:bg-layer-1-hover max-md:size-11"
                        aria-label={t("workflows.editor.panel.remove_source", { name: stateName(draft, key) })}
                        onClick={() => onChange(removeSource(draft, transition.key, key))}
                      >
                        <CloseOutline className="size-3" aria-hidden />
                      </button>
                    )}
                  </span>
                ))
              )}
              <span aria-hidden>→</span>
              <span className={`${CHIP_CLASS} ${toneClassOf(transition.target_key)}`}>
                {stateName(draft, transition.target_key)}
              </span>
            </div>
            {canEdit &&
              candidates.length > 0 &&
              (isAddingSource ? (
                <select
                  ref={sourcePickerRef}
                  className={`w-full ${FIELD_CLASS}`}
                  aria-label={t("workflows.editor.panel.add_source")}
                  value=""
                  onChange={(event) => {
                    onChange(
                      updateTransition(draft, transition.key, {
                        source_keys: [...transition.source_keys, event.target.value],
                      })
                    );
                    setIsAddingSource(false);
                  }}
                >
                  <option value="" disabled>
                    {t("workflows.editor.add_transition.choose_state")}
                  </option>
                  {candidates.map((item) => (
                    <option key={item.key} value={item.key}>
                      {item.status.name}
                    </option>
                  ))}
                </select>
              ) : (
                <button type="button" className={LINK_CLASS} onClick={() => setIsAddingSource(true)}>
                  {t("workflows.editor.panel.add_source")}
                </button>
              ))}
          </section>
          <section className="space-y-2">
            <h3 className={SECTION_TITLE_CLASS}>{t("workflows.editor.panel.rule")}</h3>
            {rule ? (
              <div className="space-y-1 rounded-md border border-subtle bg-layer-1 p-2">
                <p className="text-body-sm-medium text-primary">{t("workflows.editor.restrict.title")}</p>
                <p className="text-caption-sm-regular text-secondary">{ruleSummary(rule.params)}</p>
                {canEdit && (
                  <div className="flex gap-3">
                    <button
                      type="button"
                      className={LINK_CLASS}
                      aria-label={t("workflows.editor.panel.edit_rule")}
                      onClick={onEditRule}
                    >
                      {t("workflows.editor.panel.edit")}
                    </button>
                    <button
                      type="button"
                      className={LINK_CLASS}
                      aria-label={t("workflows.editor.panel.remove_rule")}
                      onClick={() => onChange(setRestriction(draft, transition.key, null))}
                    >
                      {t("workflows.editor.panel.remove")}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <>
                <p className="text-caption-sm-regular text-tertiary">{t("workflows.editor.restrict.description")}</p>
                {canEdit && (
                  <button type="button" className={LINK_CLASS} onClick={onEditRule}>
                    {t("workflows.editor.add_rule.title")}
                  </button>
                )}
              </>
            )}
          </section>
          {canEdit && (
            <div className={FOOT_CLASS}>
              <Button
                variant="danger-outline"
                size="sm"
                stretch="auto"
                label={t("workflows.editor.panel.remove_transition")}
                onClick={() => onChange(removeTransition(draft, transition.key))}
              />
            </div>
          )}
        </>
      )}
    </aside>
  );
});
