/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { IState, TIssue, TProjectWorkflowScheme, TWorkflowGraph, TWorkflowRule } from "@plane/types";

export type TWorkflowActor = { userId: string | undefined; projectRole: number | undefined };
export type TWorkflowIssue = Pick<TIssue, "state_id" | "type_id" | "assignee_ids" | "created_by">;

// The server answers one of these codes, never free text (spec 4.5).
export const WORKFLOW_REFUSAL_KEYS = {
  transition_not_allowed: "workflows.workflow_disabled.title",
  arrival_state_required: "workflows.refusal.arrival_state_required",
} as const;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

export const getIssueWorkflow = (
  scheme: TProjectWorkflowScheme | undefined,
  typeId: string | null | undefined
): TWorkflowGraph | undefined => {
  if (!scheme?.default_workflow_id) return undefined;
  const workflowId =
    scheme.items.find((item) => item.issue_type_id === typeId)?.workflow_id ?? scheme.default_workflow_id;
  return scheme.workflows.find((workflow) => workflow.id === workflowId);
};

const stateIdsByStatus = (projectStates: IState[]) =>
  new Map(
    projectStates.flatMap((state) => (state.workflow_status ? [[state.workflow_status, state.id] as const] : []))
  );

// Mirrors the server rule (W6): any one criterion admits the actor, workspace admins are not exempt.
const ruleAllows = (rule: TWorkflowRule, issue: TWorkflowIssue, actor: TWorkflowActor) => {
  if (rule.type !== "restrict_actors" || !actor.userId) return false;
  const { roles = [], user_ids = [], assignee, creator } = rule.params;
  return (
    user_ids.includes(actor.userId) ||
    (creator === true && issue.created_by === actor.userId) ||
    (assignee === true && issue.assignee_ids.includes(actor.userId)) ||
    (actor.projectRole !== undefined && roles.includes(actor.projectRole))
  );
};

/** Spec 7.4: states the actor may move the item to, plus its current state; null for a free project. */
export const getAllowedTargetStateIds = ({
  scheme,
  projectStates,
  issue,
  actor,
}: {
  scheme: TProjectWorkflowScheme | undefined;
  projectStates: IState[];
  issue: TWorkflowIssue;
  actor: TWorkflowActor;
}): Set<string> | null => {
  if (!scheme?.default_workflow_id) return null;
  const allowed = new Set<string>(issue.state_id ? [issue.state_id] : []);
  const workflow = getIssueWorkflow(scheme, issue.type_id);
  if (!workflow) return allowed;
  const byStatus = stateIdsByStatus(projectStates);
  const currentStatus = projectStates.find((state) => state.id === issue.state_id)?.workflow_status;
  const currentNode = workflow.states.find((node) => node.status.id === currentStatus);
  for (const transition of workflow.transitions) {
    // Unmanaged and triage states only have global exits (P5).
    const fromHere = transition.from_any || (!!currentNode && transition.source_ids.includes(currentNode.id));
    if (!fromHere || !transition.rules.every((rule) => ruleAllows(rule, issue, actor))) continue;
    const target = workflow.states.find((node) => node.id === transition.target_id);
    const stateId = target && byStatus.get(target.status.id);
    if (stateId) allowed.add(stateId);
  }
  return allowed;
};

/** `typeId` is the effective type id: the project's default type when the item has none, as the server does. */
export const getInitialStateId = (
  scheme: TProjectWorkflowScheme | undefined,
  projectStates: IState[],
  typeId: string | null | undefined
): string | undefined => {
  const initial = getIssueWorkflow(scheme, typeId)?.states.find((node) => node.is_initial);
  return initial ? stateIdsByStatus(projectStates).get(initial.status.id) : undefined;
};

/** `typeId` is the effective type id (see getInitialStateId). W9: every state of the type's workflow can receive an item changing type; null for a free project. */
export const getWorkflowStateIds = (
  scheme: TProjectWorkflowScheme | undefined,
  projectStates: IState[],
  typeId: string | null | undefined
): Set<string> | null => {
  const workflow = getIssueWorkflow(scheme, typeId);
  if (!workflow) return null;
  const byStatus = stateIdsByStatus(projectStates);
  return new Set(workflow.states.flatMap((node) => byStatus.get(node.status.id) ?? []));
};

export const getWorkflowRefusalKey = (error: unknown): string | undefined => {
  if (!isRecord(error) || !Array.isArray(error.workflow)) return undefined;
  const code = error.workflow[0];
  return typeof code === "string" && code in WORKFLOW_REFUSAL_KEYS
    ? WORKFLOW_REFUSAL_KEYS[code as keyof typeof WORKFLOW_REFUSAL_KEYS]
    : undefined;
};

/** Spec 5.4: a linked project's states mirror its workflows and are edited there only. */
export const isProjectWorkflowManaged = (scheme: TProjectWorkflowScheme | undefined) => !!scheme?.default_workflow_id;
