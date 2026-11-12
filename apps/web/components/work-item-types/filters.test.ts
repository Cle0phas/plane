/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import {
  EIssueGroupBYServerToProperty,
  EIssueGroupByToServerOptions,
  ISSUE_DISPLAY_FILTERS_BY_PAGE,
  ISSUE_DISPLAY_PROPERTIES,
  ISSUE_GROUP_BY_OPTIONS,
} from "@plane/constants";
import { COLLECTION_OPERATOR, WORK_ITEM_FILTER_PROPERTY_KEYS } from "@plane/types";
import type { TIssueType, TWorkItemFilterProperty } from "@plane/types";
import { getWorkItemTypeFilterConfig } from "@plane/utils";
import type { TCreateWorkItemTypeFilterParams } from "@plane/utils";

const buildType = (id: string, name: string): TIssueType => ({ id, name }) as TIssueType;

describe("work item type filter and grouping", () => {
  it("groups by type on the server type_id column", () => {
    expect(EIssueGroupByToServerOptions["issue_type"]).toBe("type_id");
    expect(EIssueGroupBYServerToProperty["type_id"]).toBe("type_id");
    expect(ISSUE_GROUP_BY_OPTIONS.some((option) => option.key === "issue_type")).toBe(true);
    const layouts = ISSUE_DISPLAY_FILTERS_BY_PAGE.issues?.layoutOptions;
    expect(layouts?.list?.display_filters?.group_by).toContain("issue_type");
    expect(layouts?.kanban?.display_filters?.group_by).toContain("issue_type");
    expect(layouts?.kanban?.display_filters?.sub_group_by).toContain("issue_type");
  });

  it("offers the type filter and display property on the work items page", () => {
    expect(WORK_ITEM_FILTER_PROPERTY_KEYS).toContain("type_id");
    expect(ISSUE_DISPLAY_FILTERS_BY_PAGE.issues?.filters).toContain("type_id");
    expect(ISSUE_DISPLAY_PROPERTIES.some((property) => property.key === "issue_type")).toBe(true);
  });

  it("lists exactly the given types as IN options keyed by type id", () => {
    const config = getWorkItemTypeFilterConfig<TWorkItemFilterProperty>("type_id")({
      isEnabled: true,
      allowedOperators: new Set([COLLECTION_OPERATOR.IN]),
      label: "Work item type",
      workItemTypes: [buildType("bug-id", "Bug"), buildType("task-id", "Task")],
      getOptionIcon: () => null,
    } as TCreateWorkItemTypeFilterParams);
    expect(config.id).toBe("type_id");
    expect(config.label).toBe("Work item type");
    expect([...config.supportedOperatorConfigsMap.keys()]).toEqual([COLLECTION_OPERATOR.IN]);
    const operatorConfig = config.supportedOperatorConfigsMap.get(COLLECTION_OPERATOR.IN) as {
      getOptions: () => { value: string; label: string }[];
    };
    expect(operatorConfig.getOptions().map(({ value, label }) => ({ value, label }))).toEqual([
      { value: "bug-id", label: "Bug" },
      { value: "task-id", label: "Task" },
    ]);
  });
});
