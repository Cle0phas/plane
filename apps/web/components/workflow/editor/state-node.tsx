/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";

export type TStateNodeData = {
  name: string;
  color: string;
  groupLabel: string;
  isInitial: boolean;
  startLabel: string;
  globalLabel: string | undefined;
};
export type TStateNode = Node<TStateNodeData, "workflowState">;

export function WorkflowStateNode({ data, selected }: NodeProps<TStateNode>) {
  return (
    <div
      className={`min-w-40 rounded-md border-2 bg-layer-1 px-3 py-2 ${selected ? "ring-2 ring-accent-strong" : ""}`}
      style={{ borderColor: data.color }}
    >
      <Handle type="target" position={Position.Top} />
      {data.isInitial && (
        <span className="mb-1 inline-block rounded-sm bg-accent-primary px-1 text-caption-sm-medium text-on-color">
          {data.startLabel}
        </span>
      )}
      <div className="text-body-sm-medium text-primary">{data.name}</div>
      <div className="text-caption-sm-regular text-tertiary">{data.groupLabel}</div>
      {data.globalLabel && (
        <div className="mt-1 text-caption-sm-regular text-secondary" title={data.globalLabel}>
          {data.globalLabel}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
