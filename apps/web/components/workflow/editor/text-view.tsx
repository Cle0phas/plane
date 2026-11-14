/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { ChevronDownOutline, ChevronRightOutline } from "@makeplane/propel/icons";
import { useTranslation } from "@plane/i18n";
// local imports
import { routeLabel, textRows, toneOf, type TDraftGraph, type TTextTransition } from "./graph-model";
import { TONE_CLASS } from "./tones";
import type { TEditorSelection } from "./workflow-canvas";

type Props = {
  draft: TDraftGraph;
  selection: TEditorSelection;
  onSelect: (selection: TEditorSelection) => void;
};

export function WorkflowTextView({ draft, selection, onSelect }: Props) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const rows = textRows(draft);

  if (rows.length === 0)
    return <p className="p-6 text-body-sm-regular text-tertiary">{t("workflows.editor.text.empty")}</p>;

  const originOf = (item: TTextTransition) => {
    if (item.origin === "start") return t("workflows.editor.text.origin_start");
    if (item.origin === "any") return t("workflows.editor.text.origin_any");
    return item.sourceName ?? "";
  };

  return (
    <div className="h-full overflow-auto p-6">
      <table
        className="w-full table-fixed border-separate border-spacing-0 rounded-lg border border-subtle"
        aria-label={t("workflows.editor.view.text")}
      >
        <thead>
          <tr className="text-left text-body-xs-medium text-secondary">
            <th className="w-12 border-b border-subtle p-2" />
            <th className="w-72 border-b border-subtle p-2">{t("workflows.editor.text.state")}</th>
            <th className="border-b border-subtle p-2">{t("workflows.editor.text.transitions")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isOpen = !collapsed.includes(row.key);
            const isSelected = selection?.kind === "state" && selection.key === row.key;
            return (
              <tr key={row.key} className="align-top">
                <td className="border-b border-subtle p-2">
                  <button
                    type="button"
                    className="flex size-8 items-center justify-center rounded-md hover:bg-layer-1 max-md:size-11"
                    aria-expanded={isOpen}
                    aria-label={t("workflows.editor.text.toggle", { name: row.name })}
                    onClick={() =>
                      setCollapsed((current) =>
                        isOpen ? [...current, row.key] : current.filter((key) => key !== row.key)
                      )
                    }
                  >
                    {isOpen ? (
                      <ChevronDownOutline className="size-4" aria-hidden />
                    ) : (
                      <ChevronRightOutline className="size-4" aria-hidden />
                    )}
                  </button>
                </td>
                <td className={`border-b border-subtle p-2 ${isSelected ? "bg-layer-1-selected" : ""}`}>
                  <button
                    type="button"
                    className={`rounded-sm border px-2 py-1 text-caption-sm-medium uppercase max-md:min-h-11 max-md:min-w-11 ${TONE_CLASS[toneOf(row.group)]}`}
                    aria-current={isSelected ? "true" : undefined}
                    // The editor focuses this row after adding the state (spec 3.3).
                    data-state-key={row.key}
                    onClick={() => onSelect({ kind: "state", key: row.key })}
                  >
                    {row.name}
                  </button>
                  <p className="mt-1 text-caption-sm-regular text-tertiary">{t(`workflows.groups.${row.group}`)}</p>
                </td>
                <td className="border-b border-subtle p-2">
                  {isOpen && (
                    <ul className="space-y-1">
                      {row.transitions.map((item) => {
                        const route = routeLabel(originOf(item), row.name);
                        const label = `${item.name || t("workflows.editor.text.unnamed")} (${route})`;
                        const key = item.key;
                        // A transition with several sources repeats its key under one state, so its source completes it.
                        return (
                          <li
                            key={`${key ?? "start"}-${item.origin}-${item.sourceKey ?? ""}`}
                            className="text-body-sm-regular text-primary"
                          >
                            {key === null ? (
                              <span>{route}</span>
                            ) : (
                              <button
                                type="button"
                                className="rounded-sm text-left hover:underline max-md:min-h-11"
                                aria-current={
                                  selection?.kind === "transition" && selection.key === key ? "true" : undefined
                                }
                                onClick={() => onSelect({ kind: "transition", key })}
                              >
                                {label}
                              </button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
