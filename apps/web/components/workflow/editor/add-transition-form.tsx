/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { Button } from "@makeplane/propel/components/button";
import { InputField } from "@makeplane/propel/components/input-field";
import { useTranslation } from "@plane/i18n";
// local imports
import type { TDraftGraph, TDraftTransition } from "./graph-model";

type Props = { draft: TDraftGraph; onAdd: (transition: Omit<TDraftTransition, "key">) => void };

export function AddTransitionForm({ draft, onAdd }: Props) {
  const { t } = useTranslation();
  const [fromAny, setFromAny] = useState(false);
  const [sources, setSources] = useState<string[]>([]);
  const [target, setTarget] = useState("");
  const [name, setName] = useState("");

  const toggleSource = (key: string) =>
    setSources((current) => (current.includes(key) ? current.filter((item) => item !== key) : [...current, key]));

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!target || (!fromAny && sources.length === 0)) return;
    const sourceKeys = sources.filter((key) => key !== target);
    if (!fromAny && sourceKeys.length === 0) return;
    onAdd({
      name,
      from_any: fromAny,
      source_keys: fromAny ? [] : sourceKeys,
      target_key: target,
      rules: [],
    });
    setSources([]);
    setTarget("");
    setName("");
    setFromAny(false);
  };

  return (
    <form onSubmit={submit} className="space-y-3" aria-labelledby="workflow-add-transition-title">
      <h3 id="workflow-add-transition-title" className="text-body-sm-medium text-primary">
        {t("workflows.editor.add_transition.title")}
      </h3>
      <fieldset className="space-y-1">
        <legend className="text-body-xs-medium text-secondary">{t("workflows.editor.add_transition.sources")}</legend>
        <label className="flex items-center gap-2 text-body-xs-regular">
          <input type="checkbox" checked={fromAny} onChange={(event) => setFromAny(event.target.checked)} />
          {t("workflows.editor.add_transition.any_state")}
        </label>
        {!fromAny &&
          draft.states.map((state) => (
            <label key={state.key} className="flex items-center gap-2 text-body-xs-regular">
              <input type="checkbox" checked={sources.includes(state.key)} onChange={() => toggleSource(state.key)} />
              {state.status.name}
            </label>
          ))}
      </fieldset>
      <label className="flex flex-col gap-1 text-body-xs-medium text-secondary">
        {t("workflows.editor.add_transition.target")}
        <select
          className="rounded-md border border-subtle bg-layer-1 px-2 py-1.5"
          value={target}
          onChange={(event) => setTarget(event.target.value)}
          required
        >
          <option value="" disabled />
          {draft.states.map((state) => (
            <option key={state.key} value={state.key}>
              {state.status.name}
            </option>
          ))}
        </select>
      </label>
      <InputField
        size="md"
        orientation="vertical"
        id="workflow-new-transition-name"
        name="transition-name"
        type="text"
        label={t("workflows.editor.add_transition.name")}
        value={name}
        onChange={(event: React.ChangeEvent<HTMLInputElement>) => setName(event.target.value)}
      />
      <Button
        variant="secondary"
        size="sm"
        stretch="auto"
        type="submit"
        label={t("workflows.editor.add_transition.submit")}
      />
    </form>
  );
}
