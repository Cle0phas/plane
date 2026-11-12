/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// plane imports
import { setToast } from "@plane/blocks/toast";
import { useTranslation } from "@plane/i18n";
import type { TIssue } from "@plane/types";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useProjectState } from "@/hooks/store/use-project-state";
// components
import { IssueIdentifier } from "@/components/issues/issue-detail/issue-identifier";
import {
  ArrivalStateDialog,
  getArrivalStateIds,
  getEffectiveTypeId,
  getWorkflowRefusalKey,
  useProjectDefaultTypeId,
  useProjectWorkflowScheme,
} from "@/components/workflow";
import { getWorkItemTypeChange } from "@/components/work-item-types/helpers";
import { WorkItemTypeSelect } from "@/components/work-item-types/work-item-type-select";

export type TIssueTypeSwitcherProps = {
  issueId: string;
  disabled: boolean;
};

export const IssueTypeSwitcher = observer(function IssueTypeSwitcher(props: TIssueTypeSwitcherProps) {
  const { issueId, disabled } = props;
  const { workspaceSlug } = useParams();
  const { t } = useTranslation();
  // store hooks
  const {
    issue: { getIssueById },
    updateIssue,
  } = useIssueDetail();
  const { getProjectStates } = useProjectState();
  const [pending, setPending] = useState<{ typeId: string; stateIds: Set<string> } | null>(null);
  // derived values
  const issue = getIssueById(issueId);
  const scheme = useProjectWorkflowScheme(issue?.project_id ?? undefined);
  const projectDefaultTypeId = useProjectDefaultTypeId(issue?.project_id ?? undefined);

  if (!issue || !issue.project_id) return <></>;
  const projectId = issue.project_id;

  const submitChange = async (change: Partial<TIssue>) => {
    if (!workspaceSlug) return;
    try {
      // The store applies the change optimistically and reverts it when the request fails.
      await updateIssue(workspaceSlug.toString(), projectId, issueId, change);
    } catch (error) {
      setToast({
        type: "error",
        title: t("common.error.label"),
        message: t(getWorkflowRefusalKey(error) ?? "entity.update.failed", { entity: t("issue.label", { count: 1 }) }),
      });
    }
  };

  const handleChange = async (typeId: string) => {
    const change = getWorkItemTypeChange(issue.type_id, typeId);
    if (!change) return;
    // W9: the current state must exist in the new workflow, otherwise the user picks the arrival state.
    const stateIds = getArrivalStateIds(
      scheme,
      getProjectStates(projectId) ?? [],
      getEffectiveTypeId(issue.type_id, projectDefaultTypeId),
      typeId,
      issue.state_id
    );
    if (stateIds) {
      setPending({ typeId, stateIds });
      return;
    }
    await submitChange(change);
  };

  return (
    <div className="flex items-center gap-1">
      <WorkItemTypeSelect
        projectId={projectId}
        value={issue.type_id}
        onChange={(typeId) => void handleChange(typeId)}
        variant="icon-md"
        label={t("work_item_types.switcher.label")}
        disabled={disabled}
        keepCurrent
      />
      <IssueIdentifier
        issueId={issueId}
        projectId={projectId}
        size="md"
        enableClickToCopyIdentifier
        displayProperties={{ key: true, issue_type: false }}
      />
      {pending && (
        <ArrivalStateDialog
          isOpen
          projectId={projectId}
          stateIds={pending.stateIds}
          onClose={() => setPending(null)}
          onSubmit={(stateId) => {
            setPending(null);
            void submitChange({ type_id: pending.typeId, state_id: stateId });
          }}
        />
      )}
    </div>
  );
});
