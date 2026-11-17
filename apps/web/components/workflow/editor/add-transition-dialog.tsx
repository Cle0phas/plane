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
import { LockOutline } from "@makeplane/propel/icons";
import { useTranslation } from "@plane/i18n";
// local imports
import { isDuplicateRoute, stateName, type TDraftGraph, type TStatusOption } from "./graph-model";

export type TTransitionLock = { side: "source" | "target"; key: string };
export type TStateChoice = { kind: "state"; key: string } | { kind: "option"; option: TStatusOption };
export type TTransitionChoice = { name: string; from_any: boolean; sources: TStateChoice[]; target: TStateChoice };

type Props = {
  isOpen: boolean;
  draft: TDraftGraph;
  /** Other existing states: workspace statuses and project states that are not in the workflow (D1). */
  options: TStatusOption[];
  /** Set when the dialog is opened from a state: that side cannot be changed (D2). */
  lock: TTransitionLock | null;
  onClose: () => void;
  onAdd: (choice: TTransitionChoice) => void;
};

// Values of the two lists: a state of the draft by its key, another existing state by its index.
const STATE = "state:";
const OPTION = "option:";
const PREFIX = "workflows.editor.add_transition";
const LABEL_CLASS = "text-body-xs-medium text-secondary";
const FIELD_CLASS = "rounded-md border border-subtle bg-layer-1 px-2 py-1.5 text-body-sm-regular";
const CHECK_CLASS = "flex items-center gap-2 text-body-sm-regular text-primary max-md:min-h-11";
const HINT_CLASS = "text-caption-sm-regular text-tertiary";

export function AddTransitionDialog({ isOpen, draft, options, lock, onClose, onAdd }: Props) {
  const { t } = useTranslation();
  const [fromAny, setFromAny] = useState(false);
  const [sources, setSources] = useState<string[]>([]);
  const [target, setTarget] = useState("");
  const [name, setName] = useState("");
  const lockSide = lock?.side;
  const lockKey = lock?.key;

  useEffect(() => {
    if (!isOpen) return;
    setFromAny(false);
    setSources(lockSide === "source" && lockKey ? [`${STATE}${lockKey}`] : []);
    setTarget(lockSide === "target" && lockKey ? `${STATE}${lockKey}` : "");
    setName("");
  }, [isOpen, lockSide, lockKey]);

  const groups = [
    {
      label: t(`${PREFIX}.in_workflow`),
      entries: draft.states.map((state) => ({ value: `${STATE}${state.key}`, name: state.status.name })),
    },
    {
      label: t(`${PREFIX}.other_states`),
      hint: t(`${PREFIX}.other_states_hint`),
      entries: options.map((option, index) => ({ value: `${OPTION}${index}`, name: option.name })),
    },
  ].filter((group) => group.entries.length > 0);

  const toChoice = (value: string): TStateChoice =>
    value.startsWith(STATE)
      ? { kind: "state", key: value.slice(STATE.length) }
      : { kind: "option", option: options[Number(value.slice(OPTION.length))] };
  const stateKeys = (values: string[]) =>
    values.flatMap((value) => (value.startsWith(STATE) ? [value.slice(STATE.length)] : []));
  // Only a route between states already in the workflow can exist twice.
  const isDuplicate =
    target.startsWith(STATE) &&
    isDuplicateRoute(draft, {
      from_any: fromAny,
      source_keys: fromAny ? [] : stateKeys(sources),
      target_key: target.slice(STATE.length),
    });
  const isValid = target !== "" && (fromAny || sources.length > 0) && !sources.includes(target) && !isDuplicate;

  const lockedField = (labelKey: string, stateKey: string) => (
    <div className="flex flex-col gap-1">
      <label htmlFor="workflow-transition-locked" className={LABEL_CLASS}>
        {t(labelKey)}
      </label>
      <input
        id="workflow-transition-locked"
        type="text"
        readOnly
        value={stateName(draft, stateKey)}
        aria-describedby="workflow-transition-locked-note"
        className={`${FIELD_CLASS} bg-layer-2 text-tertiary`}
      />
      <p id="workflow-transition-locked-note" className={`flex items-center gap-1 ${HINT_CLASS}`}>
        <LockOutline className="size-3" aria-hidden />
        {t(`${PREFIX}.locked`)}
      </p>
    </div>
  );

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
              sources: fromAny ? [] : sources.map(toChoice),
              target: toChoice(target),
            });
          }}
        >
          <DialogMain>
            <DialogHeader>
              <DialogHeading>
                <DialogTitle>{t(`${PREFIX}.title`)}</DialogTitle>
              </DialogHeading>
            </DialogHeader>
            <DialogBody tabIndex={0}>
              <div className="space-y-4">
                {lockSide === "source" && lockKey ? (
                  lockedField(`${PREFIX}.sources`, lockKey)
                ) : (
                  <fieldset className="space-y-2">
                    <legend className={LABEL_CLASS}>{t(`${PREFIX}.sources`)}</legend>
                    <label className={CHECK_CLASS}>
                      <input type="checkbox" checked={fromAny} onChange={(event) => setFromAny(event.target.checked)} />
                      {t(`${PREFIX}.any_state`)}
                    </label>
                    {groups.map((group) => (
                      <fieldset key={group.label} className="space-y-1">
                        <legend className="text-caption-sm-medium text-secondary">{group.label}</legend>
                        {group.hint && <p className={HINT_CLASS}>{group.hint}</p>}
                        {group.entries.map((entry) => (
                          <label key={entry.value} className={CHECK_CLASS}>
                            <input
                              type="checkbox"
                              disabled={fromAny || entry.value === target}
                              checked={!fromAny && sources.includes(entry.value)}
                              onChange={() =>
                                setSources((current) =>
                                  current.includes(entry.value)
                                    ? current.filter((value) => value !== entry.value)
                                    : [...current, entry.value]
                                )
                              }
                            />
                            {entry.name}
                          </label>
                        ))}
                      </fieldset>
                    ))}
                  </fieldset>
                )}
                {lockSide === "target" && lockKey ? (
                  lockedField(`${PREFIX}.target`, lockKey)
                ) : (
                  <label className={`flex flex-col gap-1 ${LABEL_CLASS}`}>
                    {t(`${PREFIX}.target`)}
                    <select
                      className={FIELD_CLASS}
                      value={target}
                      onChange={(event) => {
                        setTarget(event.target.value);
                        setSources((current) => current.filter((value) => value !== event.target.value));
                      }}
                    >
                      <option value="" disabled>
                        {t(`${PREFIX}.choose_state`)}
                      </option>
                      {groups.map((group) => (
                        <optgroup key={group.label} label={group.label}>
                          {group.entries.map((entry) => (
                            <option
                              key={entry.value}
                              value={entry.value}
                              // A locked source can never become the target: nothing could put it back.
                              disabled={lockSide === "source" && entry.value === `${STATE}${lockKey}`}
                            >
                              {entry.name}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </label>
                )}
                {isDuplicate && (
                  <p role="alert" className="text-body-sm-regular text-danger-primary">
                    {t(`${PREFIX}.duplicate`)}
                  </p>
                )}
                <InputField
                  size="md"
                  orientation="vertical"
                  id="workflow-transition-new-name"
                  name="transition-name"
                  type="text"
                  maxLength={255}
                  label={t(`${PREFIX}.name`)}
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
              label={t(`${PREFIX}.submit`)}
            />
          </DialogActions>
        </form>
      </DialogContent>
    </Dialog>
  );
}
