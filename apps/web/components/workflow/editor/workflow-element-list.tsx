/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { RefObject } from "react";
import { useTranslation } from "@plane/i18n";
// local imports
import type { TDraftGraph } from "./graph-model";
import type { TEditorSelection } from "./workflow-canvas";

type Props = {
  draft: TDraftGraph;
  selection: TEditorSelection;
  containerRef: RefObject<HTMLDivElement | null>;
  onOpen: (selection: NonNullable<TEditorSelection>, trigger: HTMLElement) => void;
};

// The diagram is not keyboard-operable for editing: this list is the keyboard path to every state and transition.
export function WorkflowElementList({ draft, selection, containerRef, onOpen }: Props) {
  const { t } = useTranslation();
  const stateName = (key: string) => draft.states.find((state) => state.key === key)?.status.name ?? "";
  const isSelected = (kind: "state" | "transition", key: string) => selection?.kind === kind && selection.key === key;

  return (
    <div ref={containerRef} tabIndex={-1} className="grid gap-4 md:grid-cols-2">
      <section aria-labelledby="workflow-list-states" className="space-y-1">
        <h3 id="workflow-list-states" className="text-body-xs-medium text-secondary">
          {t("workflows.editor.panel.state")}
        </h3>
        <ul className="space-y-1">
          {draft.states.map((state) => (
            <li key={state.key}>
              <button
                type="button"
                aria-pressed={isSelected("state", state.key)}
                className="w-full rounded-md border border-subtle px-2 py-1 text-left text-body-xs-regular text-primary aria-pressed:bg-layer-1-selected"
                onClick={(event) => onOpen({ kind: "state", key: state.key }, event.currentTarget)}
              >
                {state.status.name}
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="workflow-list-transitions" className="space-y-1">
        <h3 id="workflow-list-transitions" className="text-body-xs-medium text-secondary">
          {t("workflows.editor.panel.transition")}
        </h3>
        <ul className="space-y-1">
          {draft.transitions.map((transition) => (
            <li key={transition.key}>
              <button
                type="button"
                aria-pressed={isSelected("transition", transition.key)}
                className="w-full rounded-md border border-subtle px-2 py-1 text-left text-body-xs-regular text-primary aria-pressed:bg-layer-1-selected"
                onClick={(event) => onOpen({ kind: "transition", key: transition.key }, event.currentTarget)}
              >
                {transition.from_any ? t("workflows.editor.global") : transition.source_keys.map(stateName).join(", ")}
                {" → "}
                {stateName(transition.target_key)}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
