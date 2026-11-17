/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { WorkItemsOutline } from "@makeplane/propel/icons";
import { useTranslation } from "@plane/i18n";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
// components
import { IssueActivityBlockComponent } from "./";

type TIssueTypeActivity = { activityId: string; ends: "top" | "bottom" | undefined };

export const IssueTypeActivity = observer(function IssueTypeActivity(props: TIssueTypeActivity) {
  const { activityId, ends } = props;
  const { t } = useTranslation();
  const {
    activity: { getActivityById },
  } = useIssueDetail();

  const activity = getActivityById(activityId);

  if (!activity) return <></>;
  // The stored names are shown, not a store lookup: the old or new type may have been deleted since.
  return (
    <IssueActivityBlockComponent
      icon={<WorkItemsOutline className="h-3.5 w-3.5 text-secondary" aria-hidden="true" />}
      activityId={activityId}
      ends={ends}
    >
      <>
        {t("work_item_types.activity.changed_from")}{" "}
        <span className="font-medium text-primary">{activity.old_value}</span> {t("work_item_types.activity.to")}{" "}
        <span className="font-medium text-primary">{activity.new_value}</span>
      </>
    </IssueActivityBlockComponent>
  );
});
