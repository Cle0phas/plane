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
import type { TWorkflowMappingNeed } from "@plane/types";
// local imports
import { needKey } from "./scheme-helpers";

type TNamed = { id: string; name: string };

const SELECT_CLASS = "rounded-md border border-subtle bg-layer-1 px-2 py-1.5 text-body-sm-regular max-md:min-h-11";
const LABEL_CLASS = "flex flex-col gap-1 text-body-xs-medium text-secondary";
const NOTE_CLASS = "text-caption-sm-regular text-tertiary";
const ALERT_CLASS = "text-body-sm-regular text-danger-primary";

export type TSchemeFormProps = {
  isOpen: boolean;
  title: string;
  submitLabel: string;
  /** Workflows to choose from; the only one of the list when the workflow is fixed (edit types). */
  workflows: TNamed[];
  isWorkflowFixed?: boolean;
  /** Types to tick; undefined when the workflow applies to every type (link, replace). */
  types?: TNamed[];
  checkedTypeIds?: string[];
  notes: string[];
  isBusy: boolean;
  errorKey: string | null;
  onSubmit: (workflowId: string, typeIds: string[]) => void;
  onClose: () => void;
};

/** One form for the four changes of a project scheme: link, add a workflow, edit its types, replace the default. */
export function SchemeFormDialog(props: TSchemeFormProps) {
  const { isOpen, title, submitLabel, workflows, isWorkflowFixed = false, types, checkedTypeIds, notes } = props;
  const { isBusy, errorKey, onSubmit, onClose } = props;
  const { t } = useTranslation();
  const [workflowId, setWorkflowId] = useState("");
  const [typeIds, setTypeIds] = useState<string[]>([]);
  const fixedId = isWorkflowFixed ? (workflows[0]?.id ?? "") : "";
  // Compared as a string: the parent builds a new array on every render.
  const initialTypes = (checkedTypeIds ?? []).join(",");

  useEffect(() => {
    if (!isOpen) return;
    setWorkflowId(fixedId);
    setTypeIds(initialTypes ? initialTypes.split(",") : []);
  }, [isOpen, fixedId, initialTypes]);

  // Sent in the order of the list, whatever the order of the clicks.
  const orderedTypeIds = (types ?? []).map((type) => type.id).filter((id) => typeIds.includes(id));
  const isValid = workflowId !== "" && (types === undefined || orderedTypeIds.length > 0);

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
            if (isValid) onSubmit(workflowId, orderedTypeIds);
          }}
        >
          <DialogMain>
            <DialogHeader>
              <DialogHeading>
                <DialogTitle>{title}</DialogTitle>
              </DialogHeading>
            </DialogHeader>
            <DialogBody tabIndex={0}>
              <div className="space-y-4">
                <label className={LABEL_CLASS}>
                  {t("workflows.scheme.table.workflow")}
                  <select
                    className={SELECT_CLASS}
                    value={workflowId}
                    disabled={isWorkflowFixed}
                    onChange={(event) => setWorkflowId(event.target.value)}
                  >
                    <option value="" disabled>
                      {t("workflows.scheme.choose")}
                    </option>
                    {workflows.map((workflow) => (
                      <option key={workflow.id} value={workflow.id}>
                        {workflow.name}
                      </option>
                    ))}
                  </select>
                </label>
                {types && (
                  <fieldset className="space-y-1">
                    <legend className="text-body-xs-medium text-secondary">{t("workflows.scheme.types_field")}</legend>
                    {types.map((type) => (
                      <label
                        key={type.id}
                        className="flex items-center gap-2 text-body-sm-regular text-primary max-md:min-h-11"
                      >
                        <input
                          type="checkbox"
                          checked={typeIds.includes(type.id)}
                          onChange={() =>
                            setTypeIds((current) =>
                              current.includes(type.id) ? current.filter((id) => id !== type.id) : [...current, type.id]
                            )
                          }
                        />
                        {type.name}
                      </label>
                    ))}
                  </fieldset>
                )}
                {notes.map((note) => (
                  <p key={note} className={NOTE_CLASS}>
                    {note}
                  </p>
                ))}
                {errorKey && (
                  <p role="alert" className={ALERT_CLASS}>
                    {t(errorKey)}
                  </p>
                )}
              </div>
            </DialogBody>
          </DialogMain>
          <DialogActions>
            <Button
              variant="secondary"
              size="md"
              stretch="auto"
              disabled={isBusy}
              label={t("workflows.settings.form.cancel")}
              onClick={onClose}
            />
            <Button
              variant="primary"
              size="md"
              stretch="auto"
              type="submit"
              loading={isBusy}
              disabled={!isValid || isBusy}
              label={submitLabel}
            />
          </DialogActions>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type TMappingProps = {
  isOpen: boolean;
  needs: TWorkflowMappingNeed[];
  arrivals: Record<string, string>;
  statesOf: (workflowId: string) => TNamed[];
  workflowName: (workflowId: string) => string;
  isBusy: boolean;
  errorKey: string | null;
  onArrival: (key: string, statusId: string) => void;
  onApply: () => void;
  onClose: () => void;
};

/** Second step (W10): where the work items of states missing from their new workflow go. Nothing moves before Apply. */
export function SchemeMappingDialog(props: TMappingProps) {
  const { isOpen, needs, arrivals, statesOf, workflowName, isBusy, errorKey, onArrival, onApply, onClose } = props;
  const { t } = useTranslation();

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent size="md">
        <DialogMain>
          <DialogHeader>
            <DialogHeading>
              <DialogTitle>{t("workflows.scheme.mapping.title")}</DialogTitle>
            </DialogHeading>
          </DialogHeader>
          <DialogBody tabIndex={0}>
            <div className="space-y-4">
              <p className="text-body-sm-regular text-secondary">{t("workflows.scheme.mapping.description")}</p>
              {needs.map((need) => (
                <label key={needKey(need)} className={LABEL_CLASS}>
                  {t("workflows.scheme.mapping.row", {
                    state: need.state_name,
                    workflow: workflowName(need.workflow_id),
                    count: need.issue_count,
                  })}
                  <select
                    className={SELECT_CLASS}
                    value={arrivals[needKey(need)] ?? ""}
                    onChange={(event) => onArrival(needKey(need), event.target.value)}
                  >
                    <option value="" disabled>
                      {t("workflows.scheme.mapping.pick")}
                    </option>
                    {statesOf(need.workflow_id).map((state) => (
                      <option key={state.id} value={state.id}>
                        {state.name}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              {errorKey && (
                <p role="alert" className={ALERT_CLASS}>
                  {t(errorKey)}
                </p>
              )}
            </div>
          </DialogBody>
        </DialogMain>
        <DialogActions>
          <Button
            variant="secondary"
            size="md"
            stretch="auto"
            disabled={isBusy}
            label={t("workflows.settings.form.cancel")}
            onClick={onClose}
          />
          <Button
            variant="primary"
            size="md"
            stretch="auto"
            loading={isBusy}
            disabled={isBusy || needs.some((need) => !arrivals[needKey(need)])}
            label={t("workflows.scheme.apply")}
            onClick={onApply}
          />
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}
