/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// plane imports
import { setToast } from "@plane/blocks/toast";
import { useTranslation } from "@plane/i18n";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
// components
import { IssueIdentifier } from "@/components/issues/issue-detail/issue-identifier";
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
  // derived values
  const issue = getIssueById(issueId);

  if (!issue || !issue.project_id) return <></>;
  const projectId = issue.project_id;

  const handleChange = async (typeId: string) => {
    const change = getWorkItemTypeChange(issue.type_id, typeId);
    if (!change || !workspaceSlug) return;
    try {
      // The store applies the change optimistically and reverts it when the request fails.
      await updateIssue(workspaceSlug.toString(), projectId, issueId, change);
    } catch {
      setToast({
        type: "error",
        title: t("common.error.label"),
        message: t("entity.update.failed", { entity: t("issue.label", { count: 1 }) }),
      });
    }
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
    </div>
  );
});
