/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { Button } from "@makeplane/propel/components/button";
import { InputField } from "@makeplane/propel/components/input-field";
import { useTranslation } from "@plane/i18n";
import type { TStateGroups } from "@plane/types";
// local imports
import {
  removeState,
  removeTransition,
  setInitial,
  setRestriction,
  updateStatus,
  updateTransition,
  type TDraftGraph,
} from "./graph-model";
import { RestrictActorsForm } from "./restrict-actors-form";
import type { TEditorSelection } from "./workflow-canvas";

const GROUPS: TStateGroups[] = ["backlog", "unstarted", "started", "completed", "cancelled"];

type Props = {
  draft: TDraftGraph;
  selection: TEditorSelection;
  readOnly: boolean;
  onChange: (draft: TDraftGraph) => void;
  onClose: () => void;
};

export const WorkflowSidePanel = observer(function WorkflowSidePanel({
  draft,
  selection,
  readOnly,
  onChange,
  onClose,
}: Props) {
  const { t } = useTranslation();
  if (!selection) return null;
  const state = selection.kind === "state" ? draft.states.find((item) => item.key === selection.key) : undefined;
  const transition =
    selection.kind === "transition" ? draft.transitions.find((item) => item.key === selection.key) : undefined;
  if (!state && !transition) return null;

  return (
    <aside
      className="w-80 shrink-0 space-y-4 rounded-md border border-subtle p-4"
      aria-label={t(state ? "workflows.editor.panel.state" : "workflows.editor.panel.transition")}
    >
      <div className="flex items-center justify-between">
        <h3 className="text-body-sm-medium text-primary">
          {t(state ? "workflows.editor.panel.state" : "workflows.editor.panel.transition")}
        </h3>
        <Button variant="ghost" size="sm" stretch="auto" label={t("workflows.editor.panel.close")} onClick={onClose} />
      </div>
      {state && (
        <fieldset className="space-y-3" disabled={readOnly}>
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
            label={t("workflows.editor.add_state.name")}
            value={state.status.name}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
              onChange(updateStatus(draft, state.key, { name: event.target.value }))
            }
          />
          <label className="flex items-center gap-2 text-body-xs-medium text-secondary">
            {t("workflows.editor.add_state.color")}
            <input
              type="color"
              value={state.status.color}
              onChange={(event) => onChange(updateStatus(draft, state.key, { color: event.target.value }))}
            />
          </label>
          <label className="flex flex-col gap-1 text-body-xs-medium text-secondary">
            {t("workflows.editor.add_state.group")}
            <select
              className="rounded-md border border-subtle bg-layer-1 px-2 py-1.5"
              value={state.status.group ?? ""}
              onChange={(event) =>
                onChange(updateStatus(draft, state.key, { group: (event.target.value || null) as TStateGroups | null }))
              }
            >
              <option value="">{t("workflows.editor.add_state.group_auto")}</option>
              {GROUPS.map((group) => (
                <option key={group} value={group}>
                  {t(`workflows.groups.${group}`)}
                </option>
              ))}
            </select>
          </label>
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
          <Button
            variant="danger-outline"
            size="sm"
            stretch="auto"
            label={t("workflows.editor.panel.remove_state")}
            onClick={() => {
              onChange(removeState(draft, state.key));
              onClose();
            }}
          />
        </fieldset>
      )}
      {transition && (
        <div className="space-y-3">
          <fieldset className="space-y-3" disabled={readOnly}>
            <InputField
              size="md"
              orientation="vertical"
              id="workflow-transition-name"
              name="transition-name"
              type="text"
              label={t("workflows.editor.add_transition.name")}
              value={transition.name}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                onChange(updateTransition(draft, transition.key, { name: event.target.value }))
              }
            />
            <p className="text-body-xs-regular text-secondary">
              {transition.from_any
                ? t("workflows.editor.global")
                : transition.source_keys
                    .map((key) => draft.states.find((item) => item.key === key)?.status.name)
                    .join(", ")}
              {" → "}
              {draft.states.find((item) => item.key === transition.target_key)?.status.name}
            </p>
          </fieldset>
          <RestrictActorsForm
            params={transition.rules[0]?.params ?? null}
            readOnly={readOnly}
            onChange={(params) => onChange(setRestriction(draft, transition.key, params))}
          />
          {!readOnly && (
            <Button
              variant="danger-outline"
              size="sm"
              stretch="auto"
              label={t("workflows.editor.panel.remove_transition")}
              onClick={() => {
                onChange(removeTransition(draft, transition.key));
                onClose();
              }}
            />
          )}
        </div>
      )}
    </aside>
  );
});
