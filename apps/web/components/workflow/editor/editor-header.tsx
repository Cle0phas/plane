/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { Button } from "@makeplane/propel/components/button";
import { AutomationsOutline, StateOutline, WorkflowsOutline } from "@makeplane/propel/icons";
import { useTranslation } from "@plane/i18n";
import type { TWorkflowProjectRef } from "@plane/types";

type Props = {
  name: string;
  description: string;
  projectCount: number;
  projects?: TWorkflowProjectRef[];
  canEdit: boolean;
  dirty: boolean;
  canSave: boolean;
  isSaving: boolean;
  onAddState: () => void;
  onAddTransition: () => void;
  onAddRule: () => void;
  onSave: () => void;
  onDiscard: () => void;
  onClose: () => void;
};

const USED_IN_CLASS = "text-caption-md-regular text-tertiary max-md:min-h-11";
const TOOL_CLASS =
  "flex flex-col items-center gap-1 rounded-md px-3 py-1 text-caption-sm-regular text-secondary hover:bg-layer-1 max-md:min-h-11";

export function EditorHeader(props: Props) {
  const { name, description, projectCount, projects, canEdit, dirty, canSave, isSaving } = props;
  const { t } = useTranslation();
  const usedIn = t("workflows.editor.used_in", { count: projectCount });
  const tools = [
    { label: t("workflows.editor.add_state.title"), Icon: StateOutline, onClick: props.onAddState },
    { label: t("workflows.editor.add_transition.title"), Icon: WorkflowsOutline, onClick: props.onAddTransition },
    { label: t("workflows.editor.add_rule.title"), Icon: AutomationsOutline, onClick: props.onAddRule },
  ];

  return (
    <header className="flex flex-wrap items-center gap-4 border-b border-subtle px-6 py-3">
      <div className="min-w-0 flex-1 space-y-1">
        <nav aria-label={t("workflows.editor.breadcrumb")} className="text-caption-md-regular text-tertiary">
          {/* Back to the list through Close, so unsaved changes get the same guard. */}
          <button type="button" className="hover:underline" onClick={props.onClose}>
            {t("workflows.label")}
          </button>
          <span aria-hidden className="px-1">
            /
          </span>
          <span aria-current="page">{name}</span>
        </nav>
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="truncate text-h5-semibold text-primary">{name}</h1>
          {/* Names only reach workspace admins (P6 of the workflows plan): without them the count is plain text. */}
          {projects && projects.length > 0 ? (
            <details className="relative">
              <summary className={`cursor-pointer ${USED_IN_CLASS}`}>{usedIn}</summary>
              <ul className="shadow-md absolute z-10 mt-1 min-w-48 rounded-md border border-subtle bg-layer-1 p-2 text-body-xs-regular text-primary">
                {projects.map((project) => (
                  <li key={project.id}>{project.name}</li>
                ))}
              </ul>
            </details>
          ) : (
            <p className={USED_IN_CLASS}>{usedIn}</p>
          )}
        </div>
        {description && (
          <p title={description} className="line-clamp-2 max-w-3xl text-body-xs-regular text-tertiary">
            {description}
          </p>
        )}
      </div>
      {canEdit && (
        <div className="flex items-center gap-1">
          {tools.map(({ label, Icon, onClick }) => (
            <button key={label} type="button" className={TOOL_CLASS} disabled={isSaving} onClick={onClick}>
              <Icon className="size-4" aria-hidden />
              {label}
            </button>
          ))}
        </div>
      )}
      {/* The propel Button takes no class: the 44px touch target below 768px is set from here (spec 3.8). */}
      <div className="flex flex-1 items-center justify-end gap-2 max-md:[&_button]:min-h-11 max-md:[&_button]:min-w-11">
        {canEdit && (
          <Button
            variant="primary"
            size="md"
            stretch="auto"
            disabled={!canSave || isSaving}
            loading={isSaving}
            label={t("workflows.editor.save")}
            onClick={props.onSave}
          />
        )}
        <Button
          variant="secondary"
          size="md"
          stretch="auto"
          disabled={isSaving}
          label={t(dirty ? "workflows.editor.discard" : "workflows.editor.close")}
          onClick={dirty ? props.onDiscard : props.onClose}
        />
      </div>
    </header>
  );
}
