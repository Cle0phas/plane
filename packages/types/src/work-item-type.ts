/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TLogoProps } from "./common";

export type TIssueType = {
  id: string;
  name: string;
  description: string;
  logo_props: TLogoProps;
  is_active: boolean;
  is_default: boolean;
  issue_count: number;
  project_default_count: number;
  created_at: string;
  updated_at: string;
};

export type TIssueTypeFormData = Pick<TIssueType, "name" | "description" | "logo_props">;

export type TIssueTypeUpdatePayload = Partial<TIssueTypeFormData & Pick<TIssueType, "is_active">> & {
  is_default?: true;
};

export type TProjectIssueType = {
  id: string;
  project_id: string;
  issue_type_id: string;
  is_default: boolean;
  issue_count: number;
};
