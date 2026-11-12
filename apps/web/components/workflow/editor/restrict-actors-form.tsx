/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { Button } from "@makeplane/propel/components/button";
import { useTranslation } from "@plane/i18n";
import type { TWorkflowRestrictActorsParams } from "@plane/types";
// hooks
import { useMember } from "@/hooks/store/use-member";

const ROLES = [
  { value: 20, key: "admin" },
  { value: 15, key: "member" },
  { value: 5, key: "guest" },
] as const;

type Props = {
  params: TWorkflowRestrictActorsParams | null;
  readOnly: boolean;
  onChange: (params: TWorkflowRestrictActorsParams | null) => void;
};

const toggle = <T,>(list: T[] | undefined, value: T) =>
  list?.includes(value) ? list.filter((item) => item !== value) : [...(list ?? []), value];

export const RestrictActorsForm = observer(function RestrictActorsForm({ params, readOnly, onChange }: Props) {
  const { t } = useTranslation();
  const {
    workspace: { workspaceMemberIds, getWorkspaceMemberDetails },
  } = useMember();
  const current = params ?? {};
  const update = (patch: TWorkflowRestrictActorsParams) => onChange({ ...current, ...patch });

  return (
    <fieldset className="space-y-2" disabled={readOnly}>
      <legend className="text-body-sm-medium text-primary">{t("workflows.editor.restrict.title")}</legend>
      <p className="text-caption-sm-regular text-tertiary">{t("workflows.editor.restrict.description")}</p>
      <fieldset className="space-y-1">
        <legend className="text-body-xs-medium text-secondary">{t("workflows.editor.restrict.roles")}</legend>
        {ROLES.map((role) => (
          <label key={role.value} className="flex items-center gap-2 text-body-xs-regular">
            <input
              type="checkbox"
              checked={current.roles?.includes(role.value) ?? false}
              onChange={() => update({ roles: toggle(current.roles, role.value) })}
            />
            {t(`workflows.roles.${role.key}`)}
          </label>
        ))}
      </fieldset>
      <fieldset className="max-h-40 space-y-1 overflow-y-auto">
        <legend className="text-body-xs-medium text-secondary">{t("workflows.editor.restrict.users")}</legend>
        {(workspaceMemberIds ?? []).map((memberId) => {
          const member = getWorkspaceMemberDetails(memberId)?.member;
          if (!member) return null;
          return (
            <label key={member.id} className="flex items-center gap-2 text-body-xs-regular">
              <input
                type="checkbox"
                checked={current.user_ids?.includes(member.id) ?? false}
                onChange={() => update({ user_ids: toggle(current.user_ids, member.id) })}
              />
              {member.display_name}
            </label>
          );
        })}
      </fieldset>
      {(["assignee", "creator"] as const).map((flag) => (
        <label key={flag} className="flex items-center gap-2 text-body-xs-regular">
          <input
            type="checkbox"
            checked={current[flag] === true}
            onChange={(event) => update({ [flag]: event.target.checked ? true : undefined })}
          />
          {t(`workflows.editor.restrict.${flag}`)}
        </label>
      ))}
      {params && !readOnly && (
        <Button
          variant="secondary"
          size="sm"
          stretch="auto"
          label={t("workflows.editor.restrict.clear")}
          onClick={() => onChange(null)}
        />
      )}
    </fieldset>
  );
});
