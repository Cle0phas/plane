/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { AutomationsOutline } from "@makeplane/propel/icons";
import type { TWorkflowSide } from "@plane/types";
// local imports
import type { TStateTone } from "./graph-model";
import { INVERSE_CLASS, TONE_CLASS } from "./tones";

export type TStateNodeData = {
  name: string;
  tone: TStateTone;
  groupLabel: string;
  globalKey: string | null;
  globalLabel: string;
  globalSelected: boolean;
};
export type TStateNode = Node<TStateNodeData, "workflowState">;

export const SIDES: TWorkflowSide[] = ["top", "right", "bottom", "left"];
const POSITION: Record<TWorkflowSide, Position> = {
  top: Position.Top,
  right: Position.Right,
  bottom: Position.Bottom,
  left: Position.Left,
};

export function WorkflowStateNode({ data, selected }: NodeProps<TStateNode>) {
  return (
    <div className="relative">
      {data.globalKey && (
        // Read by the canvas click handler: the pill selects its transition, not the state.
        <span
          data-global-key={data.globalKey}
          className={`absolute -top-7 left-1/2 flex -translate-x-1/2 cursor-pointer items-center gap-1 rounded-full px-2 py-0.5 text-caption-sm-medium whitespace-nowrap ${INVERSE_CLASS} ${data.globalSelected ? "ring-2 ring-accent-strong" : ""}`}
        >
          <AutomationsOutline className="size-3" aria-hidden />
          {data.globalLabel}
        </span>
      )}
      <div
        title={data.groupLabel}
        className={`min-w-32 rounded-sm border-2 px-4 py-2 text-center text-caption-sm-medium uppercase ${TONE_CLASS[data.tone]} ${selected ? "ring-2 ring-accent-strong" : ""}`}
      >
        {data.name}
      </div>
      {SIDES.map((side) => (
        // Every side both starts and receives arrows (loose connection mode, R17).
        <Handle
          key={side}
          id={side}
          type="source"
          position={POSITION[side]}
          className={selected ? "opacity-100" : "opacity-0"}
        />
      ))}
    </div>
  );
}
