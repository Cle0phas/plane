/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import {
  ArrowNarrowRightOutline,
  ChevronDownOutline,
  ChevronRightOutline,
  CircleOutline,
  StarOutline,
} from "@makeplane/propel/icons";
import { useTranslation } from "@plane/i18n";
// local imports
import { StateLozenge } from "../state-lozenge";
import { textRows, type TDraftGraph, type TTextLine, type TTextRow } from "./graph-model";
import type { TEditorSelection } from "./workflow-canvas";

type Props = {
  draft: TDraftGraph;
  selection: TEditorSelection;
  onSelect: (selection: TEditorSelection) => void;
};

const CELL = "border-b border-subtle align-top";

export function WorkflowTextView({ draft, selection, onSelect }: Props) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const rows = textRows(draft);

  if (rows.length === 0)
    return <p className="p-6 text-body-sm-regular text-tertiary">{t("workflows.editor.text.empty")}</p>;

  const byKey = new Map<string, TTextRow>(rows.map((row) => [row.key, row]));
  const lozenge = (key: string | undefined) => {
    const row = key === undefined ? undefined : byKey.get(key);
    return row ? <StateLozenge name={row.name} group={row.group} /> : null;
  };
  const source = (line: TTextLine) => {
    if (line.kind === "start") return <span>{t("workflows.editor.text.origin_start")}</span>;
    if (line.kind === "any") return <span>{t("workflows.editor.text.origin_any")}</span>;
    return lozenge(line.sourceKey);
  };
  const isPressed = (line: TTextLine) =>
    line.key === null ? selection?.kind === "start" : selection?.kind === "transition" && selection.key === line.key;

  return (
    <div className="h-full space-y-4 overflow-auto p-6">
      <div className="overflow-x-auto rounded-md border border-subtle">
        <table
          className="w-full min-w-[760px] table-fixed border-collapse"
          aria-label={t("workflows.editor.view.text")}
        >
          <colgroup>
            <col className="w-12" />
            <col className="w-[32%]" />
            <col />
          </colgroup>
          <thead>
            <tr className="bg-layer-1 text-left text-body-xs-medium text-secondary">
              <th scope="col" className="border-r border-b border-subtle">
                <span className="sr-only">{t("workflows.editor.text.toggle_column")}</span>
              </th>
              <th scope="col" className="border-r border-b border-subtle px-4 py-2.5">
                {t("workflows.editor.text.state")}
              </th>
              <th scope="col" className="border-b border-subtle px-4 py-2.5 text-primary">
                {t("workflows.editor.text.transitions")}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isOpen = !collapsed.includes(row.key);
              const isSelected = selection?.kind === "state" && selection.key === row.key;
              return (
                // Mouse shortcut (D11); the state button of the row is the keyboard path.
                <tr key={row.key} className="cursor-pointer" onClick={() => onSelect({ kind: "state", key: row.key })}>
                  <td className={`${CELL} border-r pt-3 text-center`}>
                    <button
                      type="button"
                      className="inline-flex size-7 items-center justify-center rounded-md text-secondary hover:bg-layer-1 max-md:size-11"
                      aria-expanded={isOpen}
                      aria-label={t("workflows.editor.text.toggle", { name: row.name })}
                      onClick={(event) => {
                        event.stopPropagation();
                        setCollapsed((current) =>
                          isOpen ? [...current, row.key] : current.filter((key) => key !== row.key)
                        );
                      }}
                    >
                      {isOpen ? (
                        <ChevronDownOutline className="size-3.5" aria-hidden />
                      ) : (
                        <ChevronRightOutline className="size-3.5" aria-hidden />
                      )}
                    </button>
                  </td>
                  <td className={`${CELL} border-r px-4 py-4 ${isSelected ? "bg-layer-1-selected" : ""}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        className="rounded-sm max-md:min-h-11"
                        aria-current={isSelected ? "true" : undefined}
                        // The editor focuses this row after adding the state (spec 3.3).
                        data-state-key={row.key}
                        onClick={(event) => {
                          event.stopPropagation();
                          onSelect({ kind: "state", key: row.key });
                        }}
                      >
                        <StateLozenge name={row.name} group={row.group} />
                      </button>
                      {row.isInitial && (
                        <span className="text-caption-md-regular text-tertiary">
                          {t("workflows.editor.text.initial_state")}
                        </span>
                      )}
                    </div>
                    {/* Colour is not the only signal of the category (WCAG 1.4.1). */}
                    <p className="mt-1 text-caption-sm-regular text-tertiary">{t(`workflows.groups.${row.group}`)}</p>
                  </td>
                  <td className={`${CELL} p-0`}>
                    {isOpen &&
                      row.lines.map((line) => {
                        const pressed = isPressed(line);
                        return (
                          <button
                            key={`${line.kind}-${line.key ?? "start"}-${line.sourceKey ?? ""}`}
                            type="button"
                            aria-pressed={pressed}
                            className={`flex w-full flex-col gap-2 border-b border-subtle px-4 py-3.5 text-left last:border-b-0 hover:bg-layer-1 ${pressed ? "bg-accent-subtle shadow-[inset_2px_0_0_var(--border-color-accent-strong)]" : ""}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              onSelect(line.key === null ? { kind: "start" } : { kind: "transition", key: line.key });
                            }}
                          >
                            <span className="flex items-center gap-1.5">
                              {line.kind === "start" && <CircleOutline className="size-3 text-secondary" aria-hidden />}
                              {line.kind === "any" && <StarOutline className="size-3 text-secondary" aria-hidden />}
                              {line.name ? (
                                <span className="text-body-sm-semibold text-primary">{line.name}</span>
                              ) : (
                                <span className="text-body-sm-regular text-tertiary italic">
                                  {t("workflows.editor.text.unnamed")}
                                </span>
                              )}
                            </span>
                            <span className="flex flex-wrap items-center gap-2.5 text-body-sm-regular text-primary">
                              {source(line)}
                              <ArrowNarrowRightOutline className="size-4 text-secondary" aria-hidden />
                              {lozenge(line.targetKey)}
                            </span>
                          </button>
                        );
                      })}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-caption-md-regular text-tertiary">
        <span className="inline-flex items-center gap-1.5">
          <CircleOutline className="size-3" aria-hidden />
          {t("workflows.editor.text.legend_start")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <StarOutline className="size-3" aria-hidden />
          {t("workflows.editor.text.legend_any")}
        </span>
        <span>{t("workflows.editor.text.legend_click")}</span>
      </p>
    </div>
  );
}
