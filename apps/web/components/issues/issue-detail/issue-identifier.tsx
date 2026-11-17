/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// plane imports
import type { TIssueIdentifierProps } from "@plane/types";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useProject } from "@/hooks/store/use-project";
import { useWorkItemType } from "@/hooks/store/use-work-item-type";
import { IdentifierText } from "@/components/issues/issue-detail/identifier-text";
import { getIdentifierVisibility } from "@/components/work-item-types/helpers";
import { WorkItemTypeIcon } from "@/components/work-item-types/work-item-type-icon";

export const IssueIdentifier = observer(function IssueIdentifier(props: TIssueIdentifierProps) {
  const { projectId, variant, size, displayProperties, enableClickToCopyIdentifier = false } = props;
  // router
  const { workspaceSlug } = useParams();
  // store hooks
  const { getProjectIdentifierById } = useProject();
  const {
    issue: { getIssueById },
  } = useIssueDetail();
  const { getTypeById } = useWorkItemType();
  // Determine if the component is using store data or not
  const isUsingStoreData = "issueId" in props;
  // derived values
  const issue = isUsingStoreData ? getIssueById(props.issueId) : null;
  const projectIdentifier = isUsingStoreData ? getProjectIdentifierById(projectId) : props.projectIdentifier;
  const issueSequenceId = isUsingStoreData ? issue?.sequence_id : props.issueSequenceId;
  // A type unknown to the store (deleted or not loaded yet) renders no icon rather than a broken one.
  const workItemType = getTypeById(
    workspaceSlug?.toString() ?? "",
    isUsingStoreData ? issue?.type_id : props.issueTypeId
  );
  const { showKey, showType } = getIdentifierVisibility(displayProperties);
  const shouldRenderType = showType && !!workItemType;

  if (!showKey && !shouldRenderType) return null;

  return (
    <div className="flex shrink-0 items-center space-x-2">
      {shouldRenderType && <WorkItemTypeIcon workItemType={workItemType} showTooltip />}
      {showKey && (
        <IdentifierText
          identifier={`${projectIdentifier}-${issueSequenceId}`}
          enableClickToCopyIdentifier={enableClickToCopyIdentifier}
          variant={variant}
          size={size}
        />
      )}
    </div>
  );
});
