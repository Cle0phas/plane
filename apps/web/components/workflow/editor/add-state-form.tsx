/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { Button } from "@makeplane/propel/components/button";
import { InputField } from "@makeplane/propel/components/input-field";
import { useTranslation } from "@plane/i18n";
import type { TStateGroups, TWorkflowStatus } from "@plane/types";
// local imports
import type { TDraftStatus } from "./graph-model";

const GROUPS: TStateGroups[] = ["backlog", "unstarted", "started", "completed", "cancelled"];

type Props = {
  availableStatuses: TWorkflowStatus[];
  onAdd: (status: TDraftStatus) => void;
};

export function AddStateForm({ availableStatuses, onAdd }: Props) {
  const { t } = useTranslation();
  const [existingId, setExistingId] = useState("");
  const [name, setName] = useState("");
  const [color, setColor] = useState("#3A3A3A");
  const [group, setGroup] = useState<TStateGroups | "">("");

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const existing = availableStatuses.find((status) => status.id === existingId);
    if (existing) {
      onAdd({
        id: existing.id,
        name: existing.name,
        color: existing.color,
        group: existing.group_is_auto ? null : existing.group,
        shared_count: existing.workflow_count ?? 0,
      });
      setExistingId("");
      return;
    }
    if (!name.trim()) return;
    onAdd({ name: name.trim(), color, group: group || null, shared_count: 0 });
    setName("");
    setGroup("");
  };

  return (
    <form onSubmit={submit} className="space-y-3" aria-labelledby="workflow-add-state-title">
      <h3 id="workflow-add-state-title" className="text-body-sm-medium text-primary">
        {t("workflows.editor.add_state.title")}
      </h3>
      <label className="flex flex-col gap-1 text-body-xs-medium text-secondary">
        {t("workflows.editor.add_state.existing")}
        <select
          className="rounded-md border border-subtle bg-layer-1 px-2 py-1.5"
          value={existingId}
          onChange={(event) => setExistingId(event.target.value)}
        >
          <option value="">{t("workflows.editor.add_state.new")}</option>
          {availableStatuses.map((status) => (
            <option key={status.id} value={status.id}>
              {status.name}
            </option>
          ))}
        </select>
      </label>
      {!existingId && (
        <>
          <InputField
            size="md"
            orientation="vertical"
            id="workflow-new-status-name"
            name="name"
            type="text"
            label={t("workflows.editor.add_state.name")}
            value={name}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => setName(event.target.value)}
          />
          <label className="flex items-center gap-2 text-body-xs-medium text-secondary">
            {t("workflows.editor.add_state.color")}
            <input type="color" value={color} onChange={(event) => setColor(event.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-body-xs-medium text-secondary">
            {t("workflows.editor.add_state.group")}
            <select
              className="rounded-md border border-subtle bg-layer-1 px-2 py-1.5"
              value={group}
              onChange={(event) => setGroup(event.target.value as TStateGroups | "")}
            >
              <option value="">{t("workflows.editor.add_state.group_auto")}</option>
              {GROUPS.map((item) => (
                <option key={item} value={item}>
                  {t(`workflows.groups.${item}`)}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      <Button
        variant="secondary"
        size="sm"
        stretch="auto"
        type="submit"
        label={t("workflows.editor.add_state.submit")}
      />
    </form>
  );
}
