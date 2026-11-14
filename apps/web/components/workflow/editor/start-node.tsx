/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
// local imports
import { INVERSE_CLASS } from "./tones";

export const START_NODE_ID = "__start__";
export const START_EDGE_ID = "__start_edge__";

type TStartNode = Node<{ label: string }, "workflowStart">;

/** Display only (X7): derived from the initial state, never saved. */
export function WorkflowStartNode({ data, selected }: NodeProps<TStartNode>) {
  return (
    <div
      className={`flex size-20 items-center justify-center rounded-full text-caption-sm-medium ${INVERSE_CLASS} ${selected ? "ring-2 ring-accent-strong ring-offset-2" : ""}`}
    >
      {data.label}
      {/* The start arrow leaves from the side facing the initial state (startPlacement). */}
      <Handle id="right" type="source" position={Position.Right} className="opacity-0" />
      <Handle id="bottom" type="source" position={Position.Bottom} className="opacity-0" />
      <Handle id="top" type="source" position={Position.Top} className="opacity-0" />
    </div>
  );
}
