/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import { Button } from "@makeplane/propel/components/button";
import {
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogHeading,
  DialogMain,
  DialogTitle,
} from "@makeplane/propel/components/dialog";
import { InputField } from "@makeplane/propel/components/input-field";
import { useTranslation } from "@plane/i18n";
// local imports
import type { TDraftGraph, TDraftTransition } from "./graph-model";

type Props = {
  isOpen: boolean;
  draft: TDraftGraph;
  preset: { sourceKey?: string; targetKey?: string } | null;
  onClose: () => void;
  onAdd: (transition: Omit<TDraftTransition, "key">) => void;
};

export function AddTransitionDialog({ isOpen, draft, preset, onClose, onAdd }: Props) {
  const { t } = useTranslation();
  const [fromAny, setFromAny] = useState(false);
  const [sources, setSources] = useState<string[]>([]);
  const [target, setTarget] = useState("");
  const [name, setName] = useState("");
  const presetSource = preset?.sourceKey;
  const presetTarget = preset?.targetKey;

  useEffect(() => {
    if (!isOpen) return;
    setFromAny(false);
    setSources(presetSource ? [presetSource] : []);
    setTarget(presetTarget ?? "");
    setName("");
  }, [isOpen, presetSource, presetTarget]);

  const isValid = target !== "" && (fromAny || sources.length > 0) && (fromAny || !sources.includes(target));

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent size="md">
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            if (!isValid) return;
            onAdd({
              name: name.trim(),
              from_any: fromAny,
              source_keys: fromAny ? [] : sources,
              target_key: target,
              rules: [],
              sides: {},
            });
          }}
        >
          <DialogMain>
            <DialogHeader>
              <DialogHeading>
                <DialogTitle>{t("workflows.editor.add_transition.title")}</DialogTitle>
              </DialogHeading>
            </DialogHeader>
            <DialogBody tabIndex={0}>
              <div className="space-y-4">
                <fieldset className="space-y-1">
                  <legend className="text-body-xs-medium text-secondary">
                    {t("workflows.editor.add_transition.sources")}
                  </legend>
                  <label className="flex items-center gap-2 text-body-sm-regular text-primary">
                    <input type="checkbox" checked={fromAny} onChange={(event) => setFromAny(event.target.checked)} />
                    {t("workflows.editor.add_transition.any_state")}
                  </label>
                  {draft.states.map((state) => (
                    <label key={state.key} className="flex items-center gap-2 text-body-sm-regular text-primary">
                      <input
                        type="checkbox"
                        disabled={fromAny || state.key === target}
                        checked={!fromAny && sources.includes(state.key)}
                        onChange={() =>
                          setSources((current) =>
                            current.includes(state.key)
                              ? current.filter((key) => key !== state.key)
                              : [...current, state.key]
                          )
                        }
                      />
                      {state.status.name}
                    </label>
                  ))}
                </fieldset>
                <label className="flex flex-col gap-1 text-body-xs-medium text-secondary">
                  {t("workflows.editor.add_transition.target")}
                  <select
                    className="rounded-md border border-subtle bg-layer-1 px-2 py-1.5"
                    value={target}
                    onChange={(event) => {
                      setTarget(event.target.value);
                      setSources((current) => current.filter((key) => key !== event.target.value));
                    }}
                  >
                    <option value="" disabled>
                      {t("workflows.editor.add_transition.choose_state")}
                    </option>
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
                  id="workflow-transition-new-name"
                  name="transition-name"
                  type="text"
                  label={t("workflows.editor.add_transition.name")}
                  value={name}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) => setName(event.target.value)}
                />
              </div>
            </DialogBody>
          </DialogMain>
          <DialogActions>
            <Button
              variant="secondary"
              size="md"
              stretch="auto"
              label={t("workflows.settings.form.cancel")}
              onClick={onClose}
            />
            <Button
              variant="primary"
              size="md"
              stretch="auto"
              type="submit"
              disabled={!isValid}
              label={t("workflows.editor.add_transition.submit")}
            />
          </DialogActions>
        </form>
      </DialogContent>
    </Dialog>
  );
}
