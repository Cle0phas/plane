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

export type TStartNode = Node<{ label: string }, "workflowStart">;

/** Display only (X7): derived from the initial state, never saved. */
export function WorkflowStartNode({ data }: NodeProps<TStartNode>) {
  return (
    <div className={`flex size-20 items-center justify-center rounded-full text-caption-sm-medium ${INVERSE_CLASS}`}>
      {data.label}
      <Handle id="right" type="source" position={Position.Right} className="opacity-0" />
    </div>
  );
}
