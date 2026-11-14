/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { createElement, useState, type ComponentProps } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MiniMap as TMiniMap, ReactFlowInstance, ReactFlow as TReactFlow } from "@xyflow/react";
import { describe, expect, it, vi } from "vitest";
import type { TDraftGraph } from "./graph-model";
import { WorkflowCanvas, type TEditorSelection } from "./workflow-canvas";

const { translate, flowProps, miniMapProps, flowInstance } = vi.hoisted(() => ({
  // Parameters are echoed so the accessible names built from them can be asserted.
  translate: vi.fn((key: string, params?: Record<string, unknown>) =>
    params ? `${key} ${JSON.stringify(params)}` : key
  ),
  flowProps: { current: undefined as ComponentProps<typeof TReactFlow> | undefined },
  miniMapProps: { current: undefined as ComponentProps<typeof TMiniMap> | undefined },
  flowInstance: { current: undefined as ReactFlowInstance | undefined },
}));

// A new t on every render, like the real hook: with the immediate ResizeObserver of the setup file,
// this is the exact condition of the render loop fixed on 2026-11-14 (X6).
vi.mock("@plane/i18n", () => ({
  useTranslation: () => ({ t: (key: string, params?: Record<string, unknown>) => translate(key, params) }),
}));

// The real ReactFlow, with its props kept so a gesture jsdom cannot draw (a reconnect) can be replayed.
vi.mock("@xyflow/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@xyflow/react")>();
  return {
    ...actual,
    MiniMap: (props: ComponentProps<typeof TMiniMap>) => {
      miniMapProps.current = props;
      return createElement(actual.MiniMap, props);
    },
    ReactFlow: (props: ComponentProps<typeof TReactFlow>) => {
      flowProps.current = props;
      return createElement(actual.ReactFlow, {
        ...props,
        onInit: (instance: ReactFlowInstance) => {
          flowInstance.current = instance;
          props.onInit?.(instance);
        },
      });
    },
  };
});

const state = (key: string, name: string, x: number, isInitial = false) => ({
  key,
  status: { name, color: "#3A3A3A", group: null, shared_count: 0 },
  position_x: x,
  position_y: 0,
  is_initial: isInitial,
});

const draft: TDraftGraph = {
  states: [state("a", "Todo", 0, true), state("b", "Done", 240)],
  transitions: [
    { key: "t", name: "Finish", from_any: false, source_keys: ["a"], target_key: "b", rules: [] },
    { key: "g", name: "", from_any: true, source_keys: [], target_key: "a", rules: [] },
  ],
};
const noop = () => {};

const renderCanvas = (props: Partial<ComponentProps<typeof WorkflowCanvas>> = {}) =>
  render(
    <div style={{ width: 800, height: 600 }}>
      <WorkflowCanvas
        draft={draft}
        canEdit
        showLabels={false}
        selection={null}
        onSelect={noop}
        onMove={noop}
        onConnect={noop}
        onSetInitial={noop}
        onRemoveState={noop}
        onRemoveTransition={noop}
        {...props}
      />
    </div>
  );

// The editor owns the selection: this harness keeps it like the editor does, so React Flow sees it come back.
function SelectingCanvas(props: Partial<ComponentProps<typeof WorkflowCanvas>>) {
  const [selection, setSelection] = useState<TEditorSelection>(null);
  return (
    <div style={{ width: 800, height: 600 }}>
      <WorkflowCanvas
        draft={draft}
        canEdit
        showLabels={false}
        selection={selection}
        onSelect={setSelection}
        onMove={noop}
        onConnect={noop}
        onSetInitial={noop}
        onRemoveState={noop}
        onRemoveTransition={noop}
        {...props}
      />
    </div>
  );
}

const flow = () => {
  if (!flowProps.current) throw new Error("ReactFlow was not rendered");
  return flowProps.current;
};
const edgeById = (id: string) => {
  const edge = flow().edges?.find((item) => item.id === id);
  if (!edge) throw new Error(`No edge ${id}`);
  return edge;
};
const nodeById = (id: string) => {
  const node = flow().nodes?.find((item) => item.id === id);
  if (!node) throw new Error(`No node ${id}`);
  return node;
};
// Found by text: React Flow keeps nodes visibility:hidden until it has handle bounds, which jsdom never
// gives, and a hidden element has no computed accessible name, so getByRole cannot match it by name.
const pill = () => {
  const button = screen.getByText("workflows.editor.global").closest("button");
  if (!button) throw new Error("The any-state pill is not a button");
  return button;
};
const scale = (container: HTMLElement) =>
  Number(
    container.querySelector<HTMLElement>(".react-flow__viewport")?.style.transform.match(/scale\(([0-9.]+)\)/)?.[1]
  );

describe("WorkflowCanvas", () => {
  it("draws the start node, the states and the any-state pill without a render loop", () => {
    renderCanvas();
    expect(screen.getByText("workflows.editor.start")).toBeTruthy();
    expect(screen.getByText("Todo")).toBeTruthy();
    expect(screen.getByText("Done")).toBeTruthy();
    expect(screen.getByText("workflows.editor.global")).toBeTruthy();
  });

  // A new edges array re-renders every edge: during a drag that is one full pass per frame.
  it("gives React Flow the same edges array when it renders again with the same props", () => {
    const props = { draft, canEdit: true, showLabels: true, selection: null };
    const element = () => (
      <WorkflowCanvas
        {...props}
        onSelect={noop}
        onMove={noop}
        onConnect={noop}
        onSetInitial={noop}
        onRemoveState={noop}
        onRemoveTransition={noop}
      />
    );
    const { rerender } = render(element());
    const first = flow().edges;
    rerender(element());
    expect(flow().edges).toBe(first);
  });

  it("draws the arrows thick and in a text colour, the selected transition thicker in the accent colour", () => {
    const { rerender } = renderCanvas();
    const plain = { stroke: "var(--text-color-secondary)", strokeWidth: 2 };
    for (const id of ["t:a", "__start_edge__"]) {
      expect(edgeById(id).style).toEqual(plain);
      expect(edgeById(id).markerEnd).toMatchObject({ color: plain.stroke });
    }
    rerender(
      <WorkflowCanvas
        draft={draft}
        canEdit
        showLabels={false}
        selection={{ kind: "transition", key: "t" }}
        onSelect={noop}
        onMove={noop}
        onConnect={noop}
        onSetInitial={noop}
        onRemoveState={noop}
        onRemoveTransition={noop}
      />
    );
    expect(edgeById("t:a").style).toEqual({ stroke: "var(--text-color-accent-primary)", strokeWidth: 3 });
    expect(edgeById("t:a").markerEnd).toMatchObject({ color: "var(--text-color-accent-primary)" });
    expect(edgeById("__start_edge__").style).toEqual(plain);
  });

  // fireEvent rather than userEvent for clicks: d3-drag reads the view of a mousedown, null under user-event.
  it("selects a state on a click and a global transition on a click on its pill", () => {
    const onSelect = vi.fn();
    renderCanvas({ onSelect });
    fireEvent.click(screen.getByText("Done"));
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "state", key: "b" });
    fireEvent.click(screen.getByText("workflows.editor.global"));
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "transition", key: "g" });
  });

  it("names every state with its category and transition counts as numbers", () => {
    renderCanvas();
    expect(translate).toHaveBeenCalledWith("workflows.editor.state_label", {
      name: "Done",
      group: "workflows.groups.completed",
      incoming: 1,
      outgoing: 0,
    });
  });

  it("names the arrows and the any-state pill through translated labels", () => {
    renderCanvas();
    expect(edgeById("t:a").ariaLabel).toBe(
      'workflows.editor.transition_label {"name":"Finish","source":"Todo","target":"Done"}'
    );
    expect(edgeById("__start_edge__").ariaLabel).toBe('workflows.editor.start_label {"name":"Todo"}');
    expect(pill().getAttribute("aria-label")).toBe(
      'workflows.editor.transition_label_unnamed {"source":"workflows.editor.global","target":"Todo"}'
    );
    renderCanvas({
      draft: { ...draft, transitions: [{ ...draft.transitions[0], key: "u", name: "" }] },
    });
    expect(edgeById("u:a").ariaLabel).toBe(
      'workflows.editor.transition_label_unnamed {"source":"Todo","target":"Done"}'
    );
  });

  it("selects the global transition from its pill with the keyboard, read-only too", async () => {
    const onSelect = vi.fn();
    renderCanvas({ onSelect, canEdit: false });
    const button = pill();
    expect(button.getAttribute("aria-pressed")).toBe("false");
    const user = userEvent.setup();
    button.focus();
    expect(document.activeElement).toBe(button);
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "transition", key: "g" });
    onSelect.mockClear();
    await user.keyboard(" ");
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "transition", key: "g" });
  });

  it("marks the pill and every arrow of the selected transition as selected", () => {
    renderCanvas({
      draft: {
        states: [state("a", "Todo", 0, true), state("b", "Doing", 240), state("c", "Done", 480)],
        transitions: [
          { key: "t", name: "Finish", from_any: false, source_keys: ["a", "b"], target_key: "c", rules: [] },
          { key: "g", name: "", from_any: true, source_keys: [], target_key: "a", rules: [] },
        ],
      },
      selection: { kind: "transition", key: "t" },
    });
    expect(edgeById("t:a").selected).toBe(true);
    expect(edgeById("t:b").selected).toBe(true);
    expect(pill().getAttribute("aria-pressed")).toBe("false");
  });

  it("presses the pill of the selected global transition", () => {
    renderCanvas({ selection: { kind: "transition", key: "g" } });
    expect(pill().getAttribute("aria-pressed")).toBe("true");
  });

  it("creates a transition with the sides of the two handles, or moves the start from the start node", () => {
    const onConnect = vi.fn();
    const onSetInitial = vi.fn();
    renderCanvas({ onConnect, onSetInitial });
    flow().onConnect?.({ source: "a", sourceHandle: "bottom", target: "b", targetHandle: "top" });
    expect(onConnect).toHaveBeenCalledWith("a", "bottom", "b", "top");
    onConnect.mockClear();
    flow().onConnect?.({ source: "__start__", sourceHandle: "right", target: "b", targetHandle: "left" });
    expect(onSetInitial).toHaveBeenCalledWith("b");
    expect(onConnect).not.toHaveBeenCalled();
    onSetInitial.mockClear();
    flow().onConnect?.({ source: "a", sourceHandle: "right", target: "a", targetHandle: "left" });
    flow().onConnect?.({ source: "a", sourceHandle: "left", target: "__start__", targetHandle: "right" });
    expect(onConnect).not.toHaveBeenCalled();
    expect(onSetInitial).not.toHaveBeenCalled();
  });

  it("selects a transition from its arrow and reports a keyboard move", () => {
    const onSelect = vi.fn();
    const onMove = vi.fn();
    renderCanvas({ onSelect, onMove });
    flow().onEdgesChange?.([{ type: "select", id: "t:a", selected: true }]);
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "transition", key: "t" });
    flow().onNodesChange?.([{ type: "position", id: "b", position: { x: 250, y: 10 }, dragging: true }]);
    expect(onMove).not.toHaveBeenCalled();
    flow().onNodesChange?.([{ type: "position", id: "b", position: { x: 255, y: 10 }, dragging: false }]);
    expect(onMove).toHaveBeenCalledWith([{ key: "b", x: 255, y: 10 }]);
  });

  // Plane's tokens switch with every theme (light, dark, high contrast, custom); colorMode only knows two.
  it("colours the minimap and the attribution with theme tokens, never with React Flow's colour mode", () => {
    renderCanvas();
    expect(flow().colorMode).toBeUndefined();
    expect(flow().className).toContain("[--xy-attribution-background-color:var(--background-color-surface-2)]");
    expect(flow().className).toContain("[&_.react-flow\\_\\_attribution_a]:text-tertiary");
    expect(miniMapProps.current).toMatchObject({
      bgColor: "var(--background-color-surface-2)",
      maskColor: "color-mix(in srgb, var(--text-color-tertiary) 15%, transparent)",
      nodeColor: "var(--border-color-strong)",
      className: "border border-subtle",
    });
  });

  it("puts the start node above the initial state when another state sits on its left", () => {
    renderCanvas({ draft: { ...draft, states: [state("a", "Todo", 0), state("b", "Done", 240, true)] } });
    expect(nodeById("__start__").position).toEqual({ x: 264, y: -160 });
    expect(edgeById("__start_edge__")).toMatchObject({
      source: "__start__",
      sourceHandle: "bottom",
      targetHandle: "top",
    });
  });

  it("never zooms past 1 when it fits the view, so a lone node keeps its size", () => {
    renderCanvas({ draft: { states: [], transitions: [] } });
    expect(flow().fitViewOptions?.maxZoom).toBe(1);
  });

  it("leaves + to a contenteditable field, whatever its value", async () => {
    const { container } = renderCanvas();
    await waitFor(() => expect(flowInstance.current).toBeDefined());
    const zoomIn = vi.spyOn(flowInstance.current as ReactFlowInstance, "zoomIn");
    const field = document.createElement("div");
    field.setAttribute("contenteditable", "");
    container.querySelector(".react-flow")?.append(field);
    fireEvent.keyDown(field, { key: "+" });
    expect(zoomIn).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByText("Done"), { key: "+" });
    expect(zoomIn).toHaveBeenCalledTimes(1);
  });

  it("allows no deletion, drag or connection in read-only mode", async () => {
    const onRemoveState = vi.fn();
    renderCanvas({ canEdit: false, onRemoveState });
    expect(flow().deleteKeyCode).toBeNull();
    expect(flow().nodesDraggable).toBe(false);
    expect(flow().nodesConnectable).toBe(false);
    for (const id of ["a", "b"]) {
      expect(nodeById(id).deletable).toBe(false);
      expect(nodeById(id).draggable).toBe(false);
      expect(nodeById(id).connectable).toBe(false);
    }
    expect(edgeById("__start_edge__").reconnectable).toBe(false);
    fireEvent.click(screen.getByText("Done"));
    await userEvent.setup().keyboard("{Delete}");
    expect(onRemoveState).not.toHaveBeenCalled();
  });

  it("moves the start only when the start arrow is dropped on another state", () => {
    const onSetInitial = vi.fn();
    renderCanvas({ onSetInitial });
    expect(edgeById("t:a").reconnectable).toBe(false);
    const connection = { source: "a", sourceHandle: "right", target: "a", targetHandle: "left" };
    flow().onReconnect?.(edgeById("t:a"), connection);
    expect(onSetInitial).not.toHaveBeenCalled();
    flow().onReconnect?.(edgeById("__start_edge__"), { ...connection, source: "__start__", target: "b" });
    expect(onSetInitial).toHaveBeenCalledWith("b");
  });

  // A click on the pill reaches the node too: React Flow must not keep that state selected behind the editor.
  it("never removes the state of a pill clicked twice when Delete is pressed", async () => {
    const onRemoveState = vi.fn();
    render(<SelectingCanvas onRemoveState={onRemoveState} />);
    fireEvent.click(pill());
    fireEvent.click(pill());
    expect(pill().getAttribute("aria-pressed")).toBe("true");
    pill().blur();
    await userEvent.setup().keyboard("{Delete}");
    expect(onRemoveState).not.toHaveBeenCalled();
    expect(nodeById("a").selected).toBe(false);
  });

  it("still selects a state with Enter on its focused node", async () => {
    const onSelect = vi.fn();
    const { container } = renderCanvas({ onSelect });
    const node = container.querySelector<HTMLElement>('.react-flow__node[data-id="b"]');
    if (!node) throw new Error("No node b");
    node.focus();
    await userEvent.setup().keyboard("{Enter}");
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "state", key: "b" });
  });

  it("removes a deleted state without removing a transition it shared with another source", async () => {
    const onRemoveState = vi.fn();
    const onRemoveTransition = vi.fn();
    render(
      <SelectingCanvas
        draft={{
          states: [state("a", "Todo", 0, true), state("b", "Doing", 240), state("c", "Done", 480)],
          transitions: [
            { key: "t", name: "Finish", from_any: false, source_keys: ["a", "b"], target_key: "c", rules: [] },
          ],
        }}
        onRemoveState={onRemoveState}
        onRemoveTransition={onRemoveTransition}
      />
    );
    fireEvent.click(screen.getByText("Doing"));
    await userEvent.setup().keyboard("{Delete}");
    await waitFor(() => expect(onRemoveState).toHaveBeenCalledWith("b"));
    expect(onRemoveTransition).not.toHaveBeenCalled();
  });

  it("removes an arrow the user deleted, and never the start node or its arrow", async () => {
    const onRemoveState = vi.fn();
    const onRemoveTransition = vi.fn();
    renderCanvas({ onRemoveState, onRemoveTransition });
    expect(nodeById("__start__").deletable).toBe(false);
    expect(edgeById("__start_edge__").deletable).toBe(false);
    flow().onDelete?.({ nodes: [], edges: [edgeById("t:a")] });
    expect(onRemoveTransition).toHaveBeenCalledWith("t");
    expect(onRemoveState).not.toHaveBeenCalled();
  });

  it("zooms with + and - from inside the diagram, read-only too", async () => {
    const { container } = renderCanvas({ canEdit: false });
    const node = screen.getByText("Done");
    await waitFor(() => expect(scale(container)).toBeGreaterThan(0));
    const before = scale(container);
    fireEvent.keyDown(node, { key: "+" });
    await waitFor(() => expect(scale(container)).toBeGreaterThan(before));
    const zoomed = scale(container);
    fireEvent.keyDown(node, { key: "-" });
    await waitFor(() => expect(scale(container)).toBeLessThan(zoomed));
  });
});
