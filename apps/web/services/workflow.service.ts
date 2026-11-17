/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { API_BASE_URL } from "@plane/constants";
import type {
  TProjectWorkflowScheme,
  TProjectWorkflowSchemePayload,
  TWorkflowDetail,
  TWorkflowEditor,
  TWorkflowFormData,
  TWorkflowGraphSavePayload,
  TWorkflowMappingNeed,
  TWorkflowStatus,
  TWorkflowStatusCandidate,
  TWorkflowSummary,
} from "@plane/types";
import { APIService } from "@/services/api.service";

export class WorkflowService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  // Every method rethrows the response body: callers map error codes, never raw server text.
  private unwrap<T>(promise: Promise<{ data: T }>): Promise<T> {
    return promise
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data ?? error;
      });
  }

  list(workspaceSlug: string): Promise<TWorkflowSummary[]> {
    return this.unwrap(this.get(`/api/workspaces/${workspaceSlug}/workflows/`));
  }

  retrieve(workspaceSlug: string, workflowId: string): Promise<TWorkflowDetail> {
    return this.unwrap(this.get(`/api/workspaces/${workspaceSlug}/workflows/${workflowId}/`));
  }

  create(workspaceSlug: string, data: TWorkflowFormData): Promise<TWorkflowDetail> {
    return this.unwrap(this.post(`/api/workspaces/${workspaceSlug}/workflows/`, data));
  }

  update(workspaceSlug: string, workflowId: string, data: Partial<TWorkflowFormData>): Promise<TWorkflowDetail> {
    return this.unwrap(this.patch(`/api/workspaces/${workspaceSlug}/workflows/${workflowId}/`, data));
  }

  remove(workspaceSlug: string, workflowId: string): Promise<void> {
    return this.unwrap(this.delete(`/api/workspaces/${workspaceSlug}/workflows/${workflowId}/`));
  }

  saveGraph(workspaceSlug: string, workflowId: string, payload: TWorkflowGraphSavePayload): Promise<TWorkflowDetail> {
    return this.unwrap(this.put(`/api/workspaces/${workspaceSlug}/workflows/${workflowId}/graph/`, payload));
  }

  sendPresence(workspaceSlug: string, workflowId: string, editing: boolean): Promise<{ editors: TWorkflowEditor[] }> {
    return this.unwrap(this.post(`/api/workspaces/${workspaceSlug}/workflows/${workflowId}/presence/`, { editing }));
  }

  listStatuses(workspaceSlug: string): Promise<TWorkflowStatus[]> {
    return this.unwrap(this.get(`/api/workspaces/${workspaceSlug}/workflow-statuses/`));
  }

  removeStatus(workspaceSlug: string, statusId: string): Promise<void> {
    return this.unwrap(this.delete(`/api/workspaces/${workspaceSlug}/workflow-statuses/${statusId}/`));
  }

  listCandidates(workspaceSlug: string): Promise<TWorkflowStatusCandidate[]> {
    return this.unwrap(this.get(`/api/workspaces/${workspaceSlug}/workflow-statuses/candidates/`));
  }

  duplicate(workspaceSlug: string, workflowId: string, name: string): Promise<TWorkflowDetail> {
    return this.unwrap(this.post(`/api/workspaces/${workspaceSlug}/workflows/${workflowId}/duplicate/`, { name }));
  }

  getProjectScheme(workspaceSlug: string, projectId: string): Promise<TProjectWorkflowScheme> {
    return this.unwrap(this.get(`/api/workspaces/${workspaceSlug}/projects/${projectId}/workflow-scheme/`));
  }

  previewProjectScheme(
    workspaceSlug: string,
    projectId: string,
    payload: TProjectWorkflowSchemePayload
  ): Promise<{ needs: TWorkflowMappingNeed[] }> {
    return this.unwrap(
      this.post(`/api/workspaces/${workspaceSlug}/projects/${projectId}/workflow-scheme/preview/`, payload)
    );
  }

  applyProjectScheme(
    workspaceSlug: string,
    projectId: string,
    payload: TProjectWorkflowSchemePayload
  ): Promise<TProjectWorkflowScheme> {
    return this.unwrap(this.put(`/api/workspaces/${workspaceSlug}/projects/${projectId}/workflow-scheme/`, payload));
  }

  detachProjectScheme(workspaceSlug: string, projectId: string): Promise<void> {
    return this.unwrap(this.delete(`/api/workspaces/${workspaceSlug}/projects/${projectId}/workflow-scheme/`));
  }
}
