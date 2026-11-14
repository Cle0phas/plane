/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  applyNodeChanges,
  ConnectionMode,
  MarkerType,
  MiniMap,
  Panel,
  ReactFlow,
  useReactFlow,
  useStore,
  type Connection,
  type Edge,
  type Node,
  type ReactFlowInstance,
} from "@xyflow/react";
// oxlint-disable-next-line import/no-unassigned-import -- React Flow stylesheet
import "@xyflow/react/dist/style.css";
import { useTranslation } from "@plane/i18n";
import type { TWorkflowSide } from "@plane/types";
// local imports
import {
  closestSides,
  displayGroup,
  startPlacement,
  stateName,
  toneOf,
  transitionCounts,
  type TDraftGraph,
} from "./graph-model";
import { START_EDGE_ID, START_NODE_ID, WorkflowStartNode } from "./start-node";
import { SIDES, WorkflowStateNode } from "./state-node";

export type TEditorSelection = { kind: "state" | "transition"; key: string } | null;

type Props = {
  draft: TDraftGraph;
  canEdit: boolean;
  showLabels: boolean;
  selection: TEditorSelection;
  onSelect: (selection: TEditorSelection) => void;
  onMove: (moves: { key: string; x: number; y: number }[]) => void;
  onConnect: (sourceKey: string, sourceSide: TWorkflowSide, targetKey: string, targetSide: TWorkflowSide) => void;
  onSetInitial: (key: string) => void;
  onRemoveState: (key: string) => void;
  onRemoveTransition: (key: string) => void;
};

// Stable reference: React Flow re-mounts nodes when nodeTypes changes.
const NODE_TYPES = { workflowState: WorkflowStateNode, workflowStart: WorkflowStartNode };
// Theme text colours, so the arrows keep their contrast on the canvas in both themes; inline styles beat
// React Flow's own grey edge rules. A fixed head size keeps the selected arrow's head the same.
const arrowLook = (color: string, strokeWidth: number) => ({
  style: { stroke: color, strokeWidth },
  markerEnd: { type: MarkerType.ArrowClosed, color, width: 32, height: 32, markerUnits: "userSpaceOnUse" },
});
const ARROW = arrowLook("var(--text-color-secondary)", 2);
const SELECTED_ARROW = arrowLook("var(--text-color-accent-primary)", 3);
const MINIMAP_HEIGHT = 150;
// Margin of every React Flow panel (.react-flow__panel): keeps the slider clear of the minimap.
const PANEL_MARGIN = 15;
// One or two nodes keep their natural size instead of filling the canvas.
const FIT_VIEW_OPTIONS = { padding: 0.2, maxZoom: 1 };

const toSide = (value: string | null | undefined, fallback: TWorkflowSide): TWorkflowSide =>
  SIDES.includes(value as TWorkflowSide) ? (value as TWorkflowSide) : fallback;

const isTextField = (target: EventTarget) =>
  target instanceof HTMLElement &&
  target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])") !== null;

function ZoomSlider({ label }: { label: string }) {
  const zoom = useStore((state) => state.transform[2]);
  const { zoomTo } = useReactFlow();
  return (
    <input
      type="range"
      className="w-40"
      aria-label={label}
      min={0.25}
      max={2}
      step={0.05}
      value={zoom}
      onChange={(event) => void zoomTo(Number(event.target.value))}
    />
  );
}

export function WorkflowCanvas({
  draft,
  canEdit,
  showLabels,
  selection,
  onSelect,
  onMove,
  onConnect,
  onSetInitial,
  onRemoveState,
  onRemoveTransition,
}: Props) {
  const { t, currentLocale } = useTranslation();
  const flowRef = useRef<ReactFlowInstance | null>(null);
  const initial = draft.states.find((state) => state.is_initial);
  const start = startPlacement(draft);
  const transitionLabel = (name: string, source: string, target: string) =>
    name
      ? t("workflows.editor.transition_label", { name, source, target })
      : t("workflows.editor.transition_label_unnamed", { source, target });

  const specs: Node[] = [
    {
      id: START_NODE_ID,
      type: "workflowStart",
      position: start ? { x: start.x, y: start.y } : { x: 0, y: 0 },
      draggable: false,
      selectable: false,
      deletable: false,
      // Nothing to do on it from the keyboard: the panel sets the initial state (spec 3.2).
      focusable: false,
      connectable: canEdit,
      ariaLabel: t("workflows.editor.start"),
      data: { label: t("workflows.editor.start") },
    },
    ...draft.states.map((state) => {
      const group = displayGroup(draft, state);
      const groupLabel = t(`workflows.groups.${group}`);
      const global = draft.transitions.find((transition) => transition.from_any && transition.target_key === state.key);
      const globalKey = global?.key ?? null;
      return {
        id: state.key,
        type: "workflowState",
        position: { x: state.position_x, y: state.position_y },
        selected: selection?.kind === "state" && selection.key === state.key,
        draggable: canEdit,
        connectable: canEdit,
        deletable: canEdit,
        ariaLabel: t("workflows.editor.state_label", {
          name: state.status.name,
          group: groupLabel,
          ...transitionCounts(draft, state.key),
        }),
        data: {
          name: state.status.name,
          tone: toneOf(group),
          groupLabel,
          globalKey,
          globalLabel: t("workflows.editor.global"),
          globalName: global ? transitionLabel(global.name, t("workflows.editor.global"), state.status.name) : "",
          globalSelected: globalKey !== null && selection?.kind === "transition" && selection.key === globalKey,
        },
      };
    }),
  ];

  // React Flow moves a dragged node through onNodesChange, so the nodes live in local state. They are
  // re-read from the draft when their content changes, compared as a string: an effect keyed on the
  // array, or on t, restarts on every render and loops with the node measurements (X6).
  const signature = JSON.stringify(specs);
  const specsRef = useRef(specs);
  specsRef.current = specs;
  const [nodes, setNodes] = useState<Node[]>(specs);
  useEffect(() => {
    setNodes((current) =>
      // oxlint-disable-next-line oxc/no-map-spread -- React state is copy-on-write; a spec may already be in state
      specsRef.current.map((spec) => {
        const measured = current.find((node) => node.id === spec.id)?.measured;
        return measured ? { ...spec, measured } : spec;
      })
    );
  }, [signature]);

  // Refit only when a state is added or removed, never on a pan or a drag (R12).
  const stateCount = draft.states.length;
  useEffect(() => {
    const frame = requestAnimationFrame(() => void flowRef.current?.fitView(FIT_VIEW_OPTIONS));
    return () => cancelAnimationFrame(frame);
  }, [stateCount]);

  // A new array re-renders every edge, once per drag frame; t is new on each render, the locale stands for it.
  const edges = useMemo((): Edge[] => {
    const positionOf = (key: string) => {
      const state = draft.states.find((item) => item.key === key);
      return state ? { x: state.position_x, y: state.position_y } : undefined;
    };
    const startEdge: Edge[] =
      initial && start
        ? [
            {
              id: START_EDGE_ID,
              source: START_NODE_ID,
              sourceHandle: start.sides.source,
              target: initial.key,
              targetHandle: start.sides.target,
              type: "step",
              ...ARROW,
              selectable: false,
              deletable: false,
              focusable: false,
              // The only arrow that can be re-dropped: on another state it moves the start (spec 3.2).
              reconnectable: canEdit ? "target" : false,
              ariaLabel: t("workflows.editor.start_label", { name: initial.status.name }),
            },
          ]
        : [];
    const transitionEdges = draft.transitions.flatMap((transition) =>
      transition.from_any
        ? []
        : transition.source_keys.flatMap((source): Edge[] => {
            const from = positionOf(source);
            const to = positionOf(transition.target_key);
            if (!from || !to) return [];
            const sides = transition.sides?.[source] ?? closestSides(from, to);
            const isSelected = selection?.kind === "transition" && selection.key === transition.key;
            return [
              {
                id: `${transition.key}:${source}`,
                source,
                sourceHandle: sides.source,
                target: transition.target_key,
                targetHandle: sides.target,
                type: "step",
                label: showLabels && transition.name ? transition.name : undefined,
                ...(isSelected ? SELECTED_ARROW : ARROW),
                selected: isSelected,
                deletable: canEdit,
                reconnectable: false,
                ariaLabel: transitionLabel(
                  transition.name,
                  stateName(draft, source),
                  stateName(draft, transition.target_key)
                ),
                data: { transitionKey: transition.key },
              },
            ];
          })
    );
    return [...startEdge, ...transitionEdges];
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- t, transitionLabel and start (from draft) change identity on every render
  }, [draft, initial, selection, showLabels, canEdit, currentLocale]);

  const handleConnect = ({ source, target, sourceHandle, targetHandle }: Connection) => {
    if (!source || !target || source === target || target === START_NODE_ID) return;
    // An arrow drawn from the start node moves the start (R18).
    if (source === START_NODE_ID) return onSetInitial(target);
    onConnect(source, toSide(sourceHandle, "right"), target, toSide(targetHandle, "left"));
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.ctrlKey || event.metaKey || event.altKey || isTextField(event.target)) return;
    // The pill is the only handle of a global transition and React Flow skips it (nokey); same key as deleteKeyCode.
    const globalKey = (event.target as HTMLElement).closest("[data-global-key]")?.getAttribute("data-global-key");
    if (canEdit && globalKey && event.key === "Delete") return onRemoveTransition(globalKey);
    // "=" is the unshifted "+" key (spec 3.9).
    if (event.key === "+" || event.key === "=") void flowRef.current?.zoomIn();
    else if (event.key === "-") void flowRef.current?.zoomOut();
  };

  return (
    <div role="group" className="size-full" aria-label={t("workflows.editor.diagram_label")} onKeyDown={handleKeyDown}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        connectionMode={ConnectionMode.Loose}
        fitView
        fitViewOptions={FIT_VIEW_OPTIONS}
        // Plane's tokens follow every theme (light, dark, high contrast, custom); colorMode only knows two.
        className="[--xy-attribution-background-color:var(--background-color-surface-2)] [&_.react-flow\_\_attribution_a]:text-tertiary"
        minZoom={0.25}
        maxZoom={2}
        nodesDraggable={canEdit}
        nodesConnectable={canEdit}
        deleteKeyCode={canEdit ? "Delete" : null}
        onInit={(instance) => {
          flowRef.current = instance;
        }}
        onNodesChange={(changes) => {
          // The editor owns the selection: a select change kept here could outlive it, so selected comes
          // from the specs only (a click on a pill would leave its state selected for Delete).
          setNodes((current) =>
            applyNodeChanges(
              changes.filter((change) => change.type !== "select"),
              current
            )
          );
          // Keyboard use never goes through onNodeClick: Enter selects a focused node and the arrow keys
          // move it, both reported here only, like the drop of a drag (dragging false, spec 3.9).
          const picked = changes.find(
            (change) => change.type === "select" && change.selected && change.id !== START_NODE_ID
          );
          if (picked && picked.type === "select" && !(selection?.kind === "state" && selection.key === picked.id))
            onSelect({ kind: "state", key: picked.id });
          const moves = changes.flatMap((change) =>
            change.type === "position" && change.position && change.dragging !== true && change.id !== START_NODE_ID
              ? [{ key: change.id, x: change.position.x, y: change.position.y }]
              : []
          );
          if (moves.length > 0) onMove(moves);
        }}
        onEdgesChange={(changes) => {
          // Enter on a focused arrow: the only way a keyboard user selects a transition in the diagram.
          const picked = changes.find((change) => change.type === "select" && change.selected);
          if (picked && picked.type === "select" && picked.id !== START_EDGE_ID)
            onSelect({ kind: "transition", key: picked.id.split(":")[0] });
        }}
        onNodeClick={(event, node) => {
          if (node.id === START_NODE_ID) return;
          const globalKey = (event.target as HTMLElement).closest("[data-global-key]")?.getAttribute("data-global-key");
          onSelect(globalKey ? { kind: "transition", key: globalKey } : { kind: "state", key: node.id });
        }}
        onEdgeClick={(_, edge) => {
          const key = edge.data?.transitionKey;
          if (typeof key === "string") onSelect({ kind: "transition", key });
        }}
        onPaneClick={() => onSelect(null)}
        onConnect={handleConnect}
        onReconnect={(edge, connection) => {
          if (edge.id === START_EDGE_ID && connection.target && connection.target !== START_NODE_ID)
            onSetInitial(connection.target);
        }}
        onDelete={({ nodes: deletedNodes, edges: deletedEdges }) => {
          // React Flow also reports the arrows of a deleted state: removeState already trims those
          // transitions to their other sources, so only arrows the user picked are removed whole.
          const removed = new Set(deletedNodes.map((node) => node.id).filter((id) => id !== START_NODE_ID));
          for (const key of removed) onRemoveState(key);
          const transitionKeys = new Set(
            deletedEdges
              .filter((edge) => !removed.has(edge.source) && !removed.has(edge.target))
              .map((edge) => edge.data?.transitionKey)
          );
          for (const key of transitionKeys) if (typeof key === "string") onRemoveTransition(key);
        }}
      >
        <MiniMap
          pannable
          zoomable
          className="border border-subtle"
          style={{ height: MINIMAP_HEIGHT }}
          bgColor="var(--background-color-surface-2)"
          maskColor="color-mix(in srgb, var(--text-color-tertiary) 15%, transparent)"
          nodeColor="var(--border-color-strong)"
          ariaLabel={t("workflows.editor.minimap")}
        />
        <Panel position="bottom-right" style={{ bottom: MINIMAP_HEIGHT + PANEL_MARGIN }}>
          <ZoomSlider label={t("workflows.editor.zoom")} />
        </Panel>
      </ReactFlow>
    </div>
  );
}
