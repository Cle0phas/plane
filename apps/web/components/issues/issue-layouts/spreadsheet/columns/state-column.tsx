/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// types
import type { TIssue } from "@plane/types";
// components
import { StateSelect } from "@/components/dropdowns/state/state-select";
import { useAllowedStateIds } from "@/components/workflow";

type Props = {
  issue: TIssue;
  onClose: () => void;
  onChange: (issue: TIssue, data: Partial<TIssue>, updates: any) => void;
  disabled: boolean;
};

export const SpreadsheetStateColumn = observer(function SpreadsheetStateColumn(props: Props) {
  const { issue, onChange, disabled, onClose } = props;
  const { workspaceSlug } = useParams();
  const allowedStateIds = useAllowedStateIds(workspaceSlug?.toString(), issue.project_id ?? undefined, issue);

  return (
    <div className="h-11 border-b-[0.5px] border-subtle">
      <StateSelect
        testId="spreadsheet-state-select"
        projectId={issue.project_id ?? undefined}
        value={issue.state_id}
        onChange={(data) => onChange(issue, { state_id: data }, { changed_property: "state", change_details: data })}
        disabled={disabled}
        // `.clickable` is what the table's keyboard navigation clicks on Enter / Space in a focused cell.
        className="clickable"
        variant="table-cell"
        onClose={onClose}
        tooltip
        allowedStateIds={allowedStateIds}
      />
    </div>
  );
});
