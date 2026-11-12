/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useMemo, useState } from "react";
import { applyNodeChanges, Background, Controls, MarkerType, ReactFlow, type Edge } from "@xyflow/react";
// oxlint-disable-next-line import/no-unassigned-import -- React Flow stylesheet
import "@xyflow/react/dist/style.css";
import { useTranslation } from "@plane/i18n";
// local imports
import type { TDraftGraph } from "./graph-model";
import { WorkflowStateNode, type TStateNode } from "./state-node";

export type TEditorSelection = { kind: "state" | "transition"; key: string } | null;

type Props = {
  draft: TDraftGraph;
  readOnly: boolean;
  selection: TEditorSelection;
  onSelect: (selection: TEditorSelection) => void;
  onMove: (key: string, x: number, y: number) => void;
  onConnect: (sourceKey: string, targetKey: string) => void;
};

// Stable reference: React Flow warns and re-mounts nodes when nodeTypes changes.
const NODE_TYPES = { workflowState: WorkflowStateNode };

export function WorkflowCanvas({ draft, readOnly, selection, onSelect, onMove, onConnect }: Props) {
  const { t } = useTranslation();

  const derivedNodes = useMemo<TStateNode[]>(
    () =>
      draft.states.map((state) => {
        const globals = draft.transitions.filter(
          (transition) => transition.from_any && transition.target_key === state.key
        );
        const group = state.status.group;
        return {
          id: state.key,
          type: "workflowState",
          position: { x: state.position_x, y: state.position_y },
          selected: selection?.kind === "state" && selection.key === state.key,
          draggable: !readOnly,
          connectable: !readOnly,
          data: {
            name: state.status.name,
            color: state.status.color,
            groupLabel: group ? t(`workflows.groups.${group}`) : t("workflows.editor.add_state.group_auto"),
            isInitial: state.is_initial,
            startLabel: t("workflows.editor.start"),
            globalLabel: globals.length > 0 ? t("workflows.editor.global") : undefined,
          },
        };
      }),
    [draft, readOnly, selection, t]
  );
  // React Flow moves a dragged node through onNodesChange; the draft only learns the final position on drop.
  const [nodes, setNodes] = useState<TStateNode[]>(derivedNodes);
  useEffect(() => setNodes(derivedNodes), [derivedNodes]);

  const edges = useMemo<Edge[]>(
    () =>
      draft.transitions.flatMap((transition) =>
        transition.from_any
          ? []
          : transition.source_keys.map((source) => ({
              id: `${transition.key}:${source}`,
              source,
              target: transition.target_key,
              label: transition.name || undefined,
              markerEnd: { type: MarkerType.ArrowClosed },
              selected: selection?.kind === "transition" && selection.key === transition.key,
              data: { transitionKey: transition.key },
            }))
      ),
    [draft, selection]
  );

  return (
    <div className="h-[560px] w-full rounded-md border border-subtle" aria-label={t("workflows.editor.diagram_label")}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onNodesChange={(changes) => setNodes((current) => applyNodeChanges(changes, current))}
        fitView
        nodesDraggable={!readOnly}
        nodesConnectable={!readOnly}
        onNodeClick={(_, node) => onSelect({ kind: "state", key: node.id })}
        onEdgeClick={(_, edge) => onSelect({ kind: "transition", key: String(edge.data?.transitionKey) })}
        onPaneClick={() => onSelect(null)}
        onNodeDragStop={(_, node) => onMove(node.id, node.position.x, node.position.y)}
        onConnect={(connection) => {
          if (connection.source && connection.target && connection.source !== connection.target)
            onConnect(connection.source, connection.target);
        }}
      >
        <Background />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
