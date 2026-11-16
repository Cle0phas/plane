/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { action, makeObservable, observable, runInAction } from "mobx";
import { computedFn } from "mobx-utils";
import type {
  TProjectWorkflowScheme,
  TProjectWorkflowSchemePayload,
  TWorkflowDetail,
  TWorkflowEditor,
  TWorkflowFormData,
  TWorkflowGraph,
  TWorkflowGraphSavePayload,
  TWorkflowMappingNeed,
  TWorkflowStatus,
  TWorkflowStatusCandidate,
  TWorkflowSummary,
} from "@plane/types";
import { WorkflowService } from "@/services/workflow.service";

export interface IWorkflowStore {
  workflowsMap: Record<string, Record<string, TWorkflowSummary>>;
  detailsMap: Record<string, TWorkflowDetail>;
  statusesMap: Record<string, TWorkflowStatus[]>;
  schemesMap: Record<string, TProjectWorkflowScheme>;
  candidatesMap: Record<string, TWorkflowStatusCandidate[]>;
  getWorkspaceWorkflows: (workspaceSlug: string) => TWorkflowSummary[];
  getWorkflowDetail: (workflowId: string) => TWorkflowDetail | undefined;
  getWorkspaceStatuses: (workspaceSlug: string) => TWorkflowStatus[];
  getProjectScheme: (projectId: string) => TProjectWorkflowScheme | undefined;
  getWorkspaceCandidates: (workspaceSlug: string) => TWorkflowStatusCandidate[];
  fetchWorkflows: (workspaceSlug: string) => Promise<TWorkflowSummary[]>;
  fetchWorkflowDetail: (workspaceSlug: string, workflowId: string) => Promise<TWorkflowDetail>;
  fetchStatuses: (workspaceSlug: string) => Promise<TWorkflowStatus[]>;
  fetchCandidates: (workspaceSlug: string) => Promise<TWorkflowStatusCandidate[]>;
  createWorkflow: (workspaceSlug: string, data: TWorkflowFormData) => Promise<TWorkflowDetail>;
  updateWorkflow: (
    workspaceSlug: string,
    workflowId: string,
    data: Partial<TWorkflowFormData>
  ) => Promise<TWorkflowDetail>;
  removeWorkflow: (workspaceSlug: string, workflowId: string) => Promise<void>;
  duplicateWorkflow: (workspaceSlug: string, workflowId: string, name: string) => Promise<TWorkflowDetail>;
  saveGraph: (
    workspaceSlug: string,
    workflowId: string,
    payload: TWorkflowGraphSavePayload
  ) => Promise<TWorkflowDetail>;
  sendPresence: (workspaceSlug: string, workflowId: string, editing: boolean) => Promise<TWorkflowEditor[]>;
  removeStatus: (workspaceSlug: string, statusId: string) => Promise<void>;
  fetchProjectScheme: (workspaceSlug: string, projectId: string) => Promise<TProjectWorkflowScheme>;
  previewProjectScheme: (
    workspaceSlug: string,
    projectId: string,
    payload: TProjectWorkflowSchemePayload
  ) => Promise<TWorkflowMappingNeed[]>;
  applyProjectScheme: (
    workspaceSlug: string,
    projectId: string,
    payload: TProjectWorkflowSchemePayload
  ) => Promise<TProjectWorkflowScheme>;
  detachProjectScheme: (workspaceSlug: string, projectId: string) => Promise<void>;
}

const toGraph = ({ id, name, description, updated_at, states, transitions }: TWorkflowDetail): TWorkflowGraph => ({
  id,
  name,
  description,
  updated_at,
  states,
  transitions,
});

// One shared array: a new [] on every read would look like a change to readers.
const NO_CANDIDATES: TWorkflowStatusCandidate[] = [];

export class WorkflowStore implements IWorkflowStore {
  // Keyed by workspace slug so a workspace switch or a late response never mixes workspaces.
  workflowsMap: Record<string, Record<string, TWorkflowSummary>> = {};
  detailsMap: Record<string, TWorkflowDetail> = {};
  statusesMap: Record<string, TWorkflowStatus[]> = {};
  schemesMap: Record<string, TProjectWorkflowScheme> = {};
  candidatesMap: Record<string, TWorkflowStatusCandidate[]> = {};
  private service: WorkflowService;

  constructor(service: WorkflowService = new WorkflowService()) {
    makeObservable(this, {
      workflowsMap: observable,
      detailsMap: observable,
      statusesMap: observable,
      schemesMap: observable,
      candidatesMap: observable,
      fetchWorkflows: action,
      fetchWorkflowDetail: action,
      fetchStatuses: action,
      fetchCandidates: action,
      createWorkflow: action,
      updateWorkflow: action,
      removeWorkflow: action,
      duplicateWorkflow: action,
      saveGraph: action,
      removeStatus: action,
      fetchProjectScheme: action,
      applyProjectScheme: action,
      detachProjectScheme: action,
    });
    this.service = service;
  }

  getWorkspaceWorkflows = computedFn((workspaceSlug: string) =>
    Object.values(this.workflowsMap[workspaceSlug] ?? {}).sort((a, b) => a.name.localeCompare(b.name))
  );

  getWorkflowDetail = computedFn((workflowId: string) => this.detailsMap[workflowId]);

  getWorkspaceStatuses = computedFn((workspaceSlug: string) => this.statusesMap[workspaceSlug] ?? []);

  getWorkspaceCandidates = computedFn((workspaceSlug: string) => this.candidatesMap[workspaceSlug] ?? NO_CANDIDATES);

  getProjectScheme = computedFn((projectId: string) => this.schemesMap[projectId]);

  fetchWorkflows = async (workspaceSlug: string) => {
    const workflows = await this.service.list(workspaceSlug);
    runInAction(() => {
      this.workflowsMap[workspaceSlug] = Object.fromEntries(workflows.map((workflow) => [workflow.id, workflow]));
    });
    return workflows;
  };

  fetchWorkflowDetail = async (workspaceSlug: string, workflowId: string) => {
    const workflow = await this.service.retrieve(workspaceSlug, workflowId);
    runInAction(() => {
      this.detailsMap[workflowId] = workflow;
    });
    return workflow;
  };

  fetchStatuses = async (workspaceSlug: string) => {
    const statuses = await this.service.listStatuses(workspaceSlug);
    runInAction(() => {
      this.statusesMap[workspaceSlug] = statuses;
    });
    return statuses;
  };

  fetchCandidates = async (workspaceSlug: string) => {
    const candidates = await this.service.listCandidates(workspaceSlug);
    runInAction(() => {
      this.candidatesMap[workspaceSlug] = candidates;
    });
    return candidates;
  };

  createWorkflow = async (workspaceSlug: string, data: TWorkflowFormData) => {
    const workflow = await this.service.create(workspaceSlug, data);
    runInAction(() => {
      this.detailsMap[workflow.id] = workflow;
    });
    await this.fetchWorkflows(workspaceSlug).catch(() => undefined);
    return workflow;
  };

  updateWorkflow = async (workspaceSlug: string, workflowId: string, data: Partial<TWorkflowFormData>) => {
    const workflow = await this.service.update(workspaceSlug, workflowId, data);
    runInAction(() => {
      this.detailsMap[workflowId] = workflow;
    });
    await this.fetchWorkflows(workspaceSlug).catch(() => undefined);
    return workflow;
  };

  removeWorkflow = async (workspaceSlug: string, workflowId: string) => {
    await this.service.remove(workspaceSlug, workflowId);
    runInAction(() => {
      delete this.workflowsMap[workspaceSlug]?.[workflowId];
      delete this.detailsMap[workflowId];
    });
  };

  duplicateWorkflow = async (workspaceSlug: string, workflowId: string, name: string) => {
    const workflow = await this.service.duplicate(workspaceSlug, workflowId, name);
    runInAction(() => {
      this.detailsMap[workflow.id] = workflow;
    });
    await this.fetchWorkflows(workspaceSlug).catch(() => undefined);
    return workflow;
  };

  saveGraph = async (workspaceSlug: string, workflowId: string, payload: TWorkflowGraphSavePayload) => {
    const workflow = await this.service.saveGraph(workspaceSlug, workflowId, payload);
    runInAction(() => {
      this.detailsMap[workflowId] = workflow;
      // Linked projects read the graph from their cached scheme (P10): keep it current.
      for (const scheme of Object.values(this.schemesMap)) {
        scheme.workflows = scheme.workflows.map((graph) => (graph.id === workflowId ? toGraph(workflow) : graph));
      }
    });
    // Counts and shared statuses changed too; a saved candidate is now a status.
    await Promise.allSettled([
      this.fetchWorkflows(workspaceSlug),
      this.fetchStatuses(workspaceSlug),
      this.fetchCandidates(workspaceSlug),
    ]);
    return workflow;
  };

  // Nothing is kept: the editors of a workflow only matter to the editor showing them.
  sendPresence = async (workspaceSlug: string, workflowId: string, editing: boolean) =>
    (await this.service.sendPresence(workspaceSlug, workflowId, editing)).editors;

  removeStatus = async (workspaceSlug: string, statusId: string) => {
    await this.service.removeStatus(workspaceSlug, statusId);
    runInAction(() => {
      this.statusesMap[workspaceSlug] = (this.statusesMap[workspaceSlug] ?? []).filter((item) => item.id !== statusId);
    });
  };

  fetchProjectScheme = async (workspaceSlug: string, projectId: string) => {
    const scheme = await this.service.getProjectScheme(workspaceSlug, projectId);
    runInAction(() => {
      this.schemesMap[projectId] = scheme;
    });
    return scheme;
  };

  previewProjectScheme = async (workspaceSlug: string, projectId: string, payload: TProjectWorkflowSchemePayload) =>
    (await this.service.previewProjectScheme(workspaceSlug, projectId, payload)).needs;

  applyProjectScheme = async (workspaceSlug: string, projectId: string, payload: TProjectWorkflowSchemePayload) => {
    const scheme = await this.service.applyProjectScheme(workspaceSlug, projectId, payload);
    runInAction(() => {
      this.schemesMap[projectId] = scheme;
    });
    return scheme;
  };

  detachProjectScheme = async (workspaceSlug: string, projectId: string) => {
    await this.service.detachProjectScheme(workspaceSlug, projectId);
    runInAction(() => {
      this.schemesMap[projectId] = { default_workflow_id: null, items: [], workflows: [] };
    });
  };
}
