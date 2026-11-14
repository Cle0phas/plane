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
import type { TStateGroups } from "@plane/types";
// local imports
import {
  createdStatus,
  optionToStatus,
  statusNameError,
  type TDraftGraph,
  type TDraftStatus,
  type TStatusOption,
} from "./graph-model";

type Props = {
  isOpen: boolean;
  draft: TDraftGraph;
  options: TStatusOption[];
  onClose: () => void;
  onAdd: (statuses: TDraftStatus[], allowAny: boolean) => void;
};

type TCreated = { name: string; group: TStateGroups | null };

const GROUPS: TStateGroups[] = ["backlog", "unstarted", "started", "completed", "cancelled"];
const keyOf = (name: string) => name.trim().toLowerCase();

export function AddStatusDialog({ isOpen, draft, options, onClose, onAdd }: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [checked, setChecked] = useState<string[]>([]);
  const [created, setCreated] = useState<TCreated[]>([]);
  const [allowAny, setAllowAny] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setQuery("");
    setChecked([]);
    setCreated([]);
    setAllowAny(false);
  }, [isOpen]);

  const needle = keyOf(query);
  const visible = options.filter((option) => keyOf(option.name).includes(needle));
  const isListed =
    options.some((option) => keyOf(option.name) === needle) || created.some((item) => keyOf(item.name) === needle);
  // An empty field is the resting state and shows nothing; spaces only are a "required" error.
  const createError = query !== "" && !isListed ? statusNameError(query, draft) : null;
  const canCreate = needle !== "" && !isListed && createError === null;
  const count = checked.length + created.length;

  const toggle = (name: string) =>
    setChecked((current) =>
      current.includes(keyOf(name)) ? current.filter((key) => key !== keyOf(name)) : [...current, keyOf(name)]
    );

  const create = () => {
    setCreated((current) => [...current, { name: query.trim(), group: null }]);
    setQuery("");
  };

  const submit = () =>
    onAdd(
      [
        ...options.filter((option) => checked.includes(keyOf(option.name))).map(optionToStatus),
        ...created.map((item) => createdStatus(item.name, item.group)),
      ],
      allowAny
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
            if (count > 0) submit();
          }}
        >
          <DialogMain>
            <DialogHeader>
              <DialogHeading>
                <DialogTitle>{t("workflows.editor.add_state.title")}</DialogTitle>
              </DialogHeading>
            </DialogHeader>
            <DialogBody tabIndex={0}>
              <div className="space-y-4">
                <p className="text-body-sm-regular text-secondary">{t("workflows.editor.add_state.description")}</p>
                <InputField
                  size="md"
                  orientation="vertical"
                  id="workflow-status-search"
                  name="status-search"
                  type="text"
                  label={t("workflows.editor.add_state.name")}
                  placeholder={t("workflows.editor.add_state.search")}
                  value={query}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)}
                  // Enter must never submit the dialog and drop what was typed.
                  onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => {
                    // An Enter that commits an IME composition is not a request to create.
                    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
                    event.preventDefault();
                    if (canCreate) create();
                  }}
                />
                {createError && (
                  <p role="alert" className="text-body-xs-regular text-danger-primary">
                    {t(`workflows.editor.add_state.errors.${createError}`)}
                  </p>
                )}
                <ul className="max-h-64 space-y-1 overflow-y-auto" aria-label={t("workflows.editor.add_state.search")}>
                  {visible.map((option) => (
                    <li key={keyOf(option.name)}>
                      <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-layer-1">
                        <input
                          type="checkbox"
                          checked={checked.includes(keyOf(option.name))}
                          onChange={() => toggle(option.name)}
                        />
                        <span className="flex-1 text-body-sm-regular text-primary">{option.name}</span>
                        <span className="text-caption-sm-regular text-tertiary">
                          {t(`workflows.groups.${option.group}`)}
                        </span>
                      </label>
                    </li>
                  ))}
                  {visible.length === 0 && !canCreate && (
                    <li className="px-2 py-1.5 text-body-sm-regular text-tertiary">
                      {t("workflows.editor.add_state.none")}
                    </li>
                  )}
                </ul>
                {canCreate && (
                  <Button
                    variant="secondary"
                    size="sm"
                    stretch="auto"
                    label={t("workflows.editor.add_state.create_option", { name: query.trim() })}
                    onClick={create}
                  />
                )}
                {created.map((item) => (
                  <div key={keyOf(item.name)} className="flex items-center gap-2 rounded-md bg-layer-1 px-2 py-1.5">
                    <span className="flex-1 text-body-sm-regular text-primary">{item.name}</span>
                    <select
                      className="rounded-md border border-subtle bg-layer-1 px-2 py-1"
                      aria-label={`${t("workflows.editor.add_state.group")} ${item.name}`}
                      value={item.group ?? ""}
                      onChange={(event) =>
                        setCreated((current) =>
                          current.map((other) =>
                            other === item
                              ? { ...other, group: (event.target.value || null) as TStateGroups | null }
                              : other
                          )
                        )
                      }
                    >
                      <option value="">{t("workflows.editor.add_state.group_auto")}</option>
                      {GROUPS.map((group) => (
                        <option key={group} value={group}>
                          {t(`workflows.groups.${group}`)}
                        </option>
                      ))}
                    </select>
                    <Button
                      variant="ghost"
                      size="sm"
                      stretch="auto"
                      label={`${t("workflows.editor.panel.remove_state")} ${item.name}`}
                      onClick={() => setCreated((current) => current.filter((other) => other !== item))}
                    />
                  </div>
                ))}
                <label className="flex items-center gap-2 text-body-sm-regular text-secondary">
                  <input type="checkbox" checked={allowAny} onChange={(event) => setAllowAny(event.target.checked)} />
                  {t("workflows.editor.add_state.allow_any")}
                </label>
                <p aria-live="polite" className="text-caption-sm-regular text-tertiary">
                  {count > 0 ? t("workflows.editor.add_state.selected", { count }) : ""}
                </p>
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
              disabled={count === 0}
              label={t("workflows.editor.add_state.submit")}
            />
          </DialogActions>
        </form>
      </DialogContent>
    </Dialog>
  );
}
