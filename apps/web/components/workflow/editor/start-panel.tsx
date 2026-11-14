/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { Button } from "@makeplane/propel/components/button";
import { useTranslation } from "@plane/i18n";
// local imports
import { clearInitial, setInitial, type TDraftGraph } from "./graph-model";

type Props = { draft: TDraftGraph; canEdit: boolean; onChange: (draft: TDraftGraph) => void };

/** Panel of the start link (spec 4.3): the state every new work item starts in. */
export function StartPanel({ draft, canEdit, onChange }: Props) {
  const { t } = useTranslation();
  const initial = draft.states.find((state) => state.is_initial);

  return (
    <fieldset className="flex flex-1 flex-col gap-4" disabled={!canEdit}>
      <label className="flex flex-col gap-1 text-body-xs-medium text-secondary">
        {t("workflows.editor.start_panel.field")}
        <select
          className="rounded-md border border-subtle bg-layer-1 px-2 py-1.5 text-body-sm-regular max-md:min-h-11"
          value={initial?.key ?? ""}
          disabled={!canEdit}
          onChange={(event) => onChange(setInitial(draft, event.target.value))}
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
      {/* No alert role: the editor banner already announces it. */}
      {!initial && draft.states.length > 0 && (
        <p className="text-body-sm-regular text-danger-primary">
          {t("workflows.editor.errors.initial_state_required")}
        </p>
      )}
      {canEdit && initial && (
        <div className="mt-auto border-t border-subtle pt-4">
          <Button
            variant="danger-outline"
            size="sm"
            stretch="auto"
            label={t("workflows.editor.start_panel.unlink")}
            onClick={() => onChange(clearInitial(draft))}
          />
        </div>
      )}
    </fieldset>
  );
}
