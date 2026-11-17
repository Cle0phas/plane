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
import { useTranslation } from "@plane/i18n";
import type { TWorkflowRestrictActorsParams } from "@plane/types";
// local imports
import { isRuleComplete, routeLabel, stateName, type TDraftGraph, type TDraftTransition } from "./graph-model";
import { RestrictActorsForm } from "./restrict-actors-form";

type Props = {
  isOpen: boolean;
  draft: TDraftGraph;
  presetKey: string | null;
  onClose: () => void;
  onApply: (transitionKey: string, params: TWorkflowRestrictActorsParams | null) => void;
};

export function AddRuleDialog({ isOpen, draft, presetKey, onClose, onApply }: Props) {
  const { t } = useTranslation();
  const [transitionKey, setTransitionKey] = useState("");
  const [params, setParams] = useState<TWorkflowRestrictActorsParams | null>(null);
  const firstKey = draft.transitions[0]?.key ?? "";
  const initialKey = draft.transitions.some((item) => item.key === presetKey) ? (presetKey as string) : firstKey;

  useEffect(() => {
    if (isOpen) setTransitionKey(initialKey);
  }, [isOpen, initialKey]);

  const transition = draft.transitions.find((item) => item.key === transitionKey);
  const currentParams = transition?.rules[0]?.params ?? null;
  // currentParams is left out on purpose: a draft update must not wipe the restriction being edited.
  useEffect(() => setParams(currentParams), [transitionKey, isOpen]); // oxlint-disable-line react-hooks/exhaustive-deps

  const labelOf = (item: TDraftTransition) => {
    const origin = item.from_any
      ? t("workflows.editor.global")
      : item.source_keys.map((key) => stateName(draft, key)).join(", ");
    const route = routeLabel(origin, stateName(draft, item.target_key));
    return item.name ? `${item.name} (${route})` : route;
  };

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
            if (transition) onApply(transition.key, params);
          }}
        >
          <DialogMain>
            <DialogHeader>
              <DialogHeading>
                <DialogTitle>{t("workflows.editor.add_rule.title")}</DialogTitle>
              </DialogHeading>
            </DialogHeader>
            <DialogBody tabIndex={0}>
              {draft.transitions.length === 0 ? (
                <p className="text-body-sm-regular text-secondary">{t("workflows.editor.add_rule.none")}</p>
              ) : (
                <div className="space-y-4">
                  <label className="flex flex-col gap-1 text-body-xs-medium text-secondary">
                    {t("workflows.editor.add_rule.transition")}
                    <select
                      className="rounded-md border border-subtle bg-layer-1 px-2 py-1.5"
                      value={transitionKey}
                      onChange={(event) => setTransitionKey(event.target.value)}
                    >
                      {draft.transitions.map((item) => (
                        <option key={item.key} value={item.key}>
                          {labelOf(item)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <RestrictActorsForm params={params} readOnly={false} onChange={setParams} />
                </div>
              )}
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
              disabled={!transition || (params !== null && !isRuleComplete({ type: "restrict_actors", params }))}
              label={t("workflows.editor.add_rule.submit")}
            />
          </DialogActions>
        </form>
      </DialogContent>
    </Dialog>
  );
}
