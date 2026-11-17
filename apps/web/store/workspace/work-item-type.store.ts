/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { action, makeObservable, observable, runInAction } from "mobx";
import { computedFn } from "mobx-utils";
// plane imports
import type { TIssueType, TIssueTypeFormData, TIssueTypeUpdatePayload, TProjectIssueType } from "@plane/types";
// services
import { WorkItemTypeService } from "@/services/work-item-type.service";

export interface IWorkItemTypeStore {
  // observables
  typesMap: Record<string, Record<string, TIssueType>>;
  projectLinksMap: Record<string, TProjectIssueType[]>;
  // computed actions
  getWorkspaceTypes: (workspaceSlug: string) => TIssueType[];
  getTypeById: (workspaceSlug: string, typeId: string | null | undefined) => TIssueType | undefined;
  getProjectTypeLink: (projectId: string, typeId: string) => TProjectIssueType | undefined;
  getProjectAssignableTypes: (workspaceSlug: string, projectId: string) => TIssueType[];
  getProjectDefaultTypeId: (projectId: string) => string | null;
  // fetch actions
  fetchWorkspaceTypes: (workspaceSlug: string) => Promise<TIssueType[]>;
  fetchProjectTypes: (workspaceSlug: string, projectId: string) => Promise<TProjectIssueType[]>;
  // crud actions
  createType: (workspaceSlug: string, data: TIssueTypeFormData) => Promise<TIssueType>;
  updateType: (workspaceSlug: string, typeId: string, data: TIssueTypeUpdatePayload) => Promise<TIssueType>;
  removeType: (workspaceSlug: string, typeId: string) => Promise<void>;
  enableInProject: (workspaceSlug: string, projectId: string, typeId: string) => Promise<void>;
  setProjectDefault: (workspaceSlug: string, projectId: string, typeId: string) => Promise<void>;
  disableInProject: (workspaceSlug: string, projectId: string, typeId: string) => Promise<void>;
}

const sortByDefaultThenName = (types: TIssueType[], isDefault: (type: TIssueType) => boolean) =>
  Array.from(types).sort((a, b) => Number(isDefault(b)) - Number(isDefault(a)) || a.name.localeCompare(b.name));

export class WorkItemTypeStore implements IWorkItemTypeStore {
  // observables
  // keyed by workspace slug so a workspace switch or a late response never mixes workspaces
  typesMap: Record<string, Record<string, TIssueType>> = {};
  projectLinksMap: Record<string, TProjectIssueType[]> = {};
  // services
  service: WorkItemTypeService;

  constructor(service: WorkItemTypeService = new WorkItemTypeService()) {
    makeObservable(this, {
      // observables
      typesMap: observable,
      projectLinksMap: observable,
      // actions
      fetchWorkspaceTypes: action,
      fetchProjectTypes: action,
      createType: action,
      updateType: action,
      removeType: action,
      enableInProject: action,
      setProjectDefault: action,
      disableInProject: action,
    });
    this.service = service;
  }

  getWorkspaceTypes = computedFn((workspaceSlug: string) =>
    sortByDefaultThenName(Object.values(this.typesMap[workspaceSlug] ?? {}), (type) => type.is_default)
  );

  getTypeById = computedFn((workspaceSlug: string, typeId: string | null | undefined) =>
    typeId ? this.typesMap[workspaceSlug]?.[typeId] : undefined
  );

  getProjectTypeLink = computedFn((projectId: string, typeId: string) =>
    this.projectLinksMap[projectId]?.find((link) => link.issue_type_id === typeId)
  );

  getProjectDefaultTypeId = computedFn(
    (projectId: string) => this.projectLinksMap[projectId]?.find((link) => link.is_default)?.issue_type_id ?? null
  );

  getProjectAssignableTypes = computedFn((workspaceSlug: string, projectId: string) => {
    const defaultTypeId = this.getProjectDefaultTypeId(projectId);
    const types = (this.projectLinksMap[projectId] ?? [])
      .map((link) => this.typesMap[workspaceSlug]?.[link.issue_type_id])
      .filter((type): type is TIssueType => !!type && type.is_active);
    return sortByDefaultThenName(types, (type) => type.id === defaultTypeId);
  });

  fetchWorkspaceTypes = async (workspaceSlug: string) => {
    const types = await this.service.list(workspaceSlug);
    runInAction(() => {
      this.typesMap[workspaceSlug] = Object.fromEntries(types.map((type) => [type.id, type]));
    });
    return types;
  };

  fetchProjectTypes = async (workspaceSlug: string, projectId: string) => {
    const links = await this.service.listProjectTypes(workspaceSlug, projectId);
    runInAction(() => {
      this.projectLinksMap[projectId] = links;
    });
    return links;
  };

  createType = async (workspaceSlug: string, data: TIssueTypeFormData) => {
    const created = await this.service.create(workspaceSlug, data);
    runInAction(() => {
      (this.typesMap[workspaceSlug] ??= {})[created.id] = created;
    });
    return created;
  };

  updateType = async (workspaceSlug: string, typeId: string, data: TIssueTypeUpdatePayload) => {
    const updated = await this.service.update(workspaceSlug, typeId, data);
    runInAction(() => {
      (this.typesMap[workspaceSlug] ??= {})[updated.id] = updated;
    });
    // A new default also clears the previous one, so the list is reloaded; a failed reload keeps the saved write.
    if (data.is_default) await this.fetchWorkspaceTypes(workspaceSlug).catch(() => undefined);
    return updated;
  };

  removeType = async (workspaceSlug: string, typeId: string) => {
    await this.service.remove(workspaceSlug, typeId);
    runInAction(() => {
      delete this.typesMap[workspaceSlug]?.[typeId];
    });
  };

  enableInProject = async (workspaceSlug: string, projectId: string, typeId: string) => {
    await this.service.enableInProject(workspaceSlug, projectId, typeId);
    await this.fetchProjectTypes(workspaceSlug, projectId);
  };

  setProjectDefault = async (workspaceSlug: string, projectId: string, typeId: string) => {
    await this.service.setProjectDefault(workspaceSlug, projectId, typeId);
    // project_default_count of the workspace types drives the deactivate action, so both lists reload.
    await Promise.allSettled([
      this.fetchProjectTypes(workspaceSlug, projectId),
      this.fetchWorkspaceTypes(workspaceSlug),
    ]);
  };

  disableInProject = async (workspaceSlug: string, projectId: string, typeId: string) => {
    await this.service.disableInProject(workspaceSlug, projectId, typeId);
    await this.fetchProjectTypes(workspaceSlug, projectId);
  };
}
