/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { API_BASE_URL } from "@plane/constants";
import type { TIssueType, TIssueTypeFormData, TIssueTypeUpdatePayload, TProjectIssueType } from "@plane/types";
import { APIService } from "@/services/api.service";

export class WorkItemTypeService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  async list(workspaceSlug: string): Promise<TIssueType[]> {
    return this.get(`/api/workspaces/${workspaceSlug}/issue-types/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async create(workspaceSlug: string, data: TIssueTypeFormData): Promise<TIssueType> {
    return this.post(`/api/workspaces/${workspaceSlug}/issue-types/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async update(workspaceSlug: string, typeId: string, data: TIssueTypeUpdatePayload): Promise<TIssueType> {
    return this.patch(`/api/workspaces/${workspaceSlug}/issue-types/${typeId}/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async remove(workspaceSlug: string, typeId: string): Promise<void> {
    return this.delete(`/api/workspaces/${workspaceSlug}/issue-types/${typeId}/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async listProjectTypes(workspaceSlug: string, projectId: string): Promise<TProjectIssueType[]> {
    return this.get(`/api/workspaces/${workspaceSlug}/projects/${projectId}/issue-types/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async enableInProject(workspaceSlug: string, projectId: string, typeId: string): Promise<TProjectIssueType> {
    return this.post(`/api/workspaces/${workspaceSlug}/projects/${projectId}/issue-types/`, { issue_type_id: typeId })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async setProjectDefault(workspaceSlug: string, projectId: string, typeId: string): Promise<TProjectIssueType> {
    return this.patch(`/api/workspaces/${workspaceSlug}/projects/${projectId}/issue-types/${typeId}/`, {
      is_default: true,
    })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async disableInProject(workspaceSlug: string, projectId: string, typeId: string): Promise<void> {
    return this.delete(`/api/workspaces/${workspaceSlug}/projects/${projectId}/issue-types/${typeId}/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }
}
