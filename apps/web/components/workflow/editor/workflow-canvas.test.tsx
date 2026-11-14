/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { createElement, type ComponentProps } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactFlow as TReactFlow } from "@xyflow/react";
import { describe, expect, it, vi } from "vitest";
import type { TDraftGraph } from "./graph-model";
import { WorkflowCanvas } from "./workflow-canvas";

const { translate, flowProps } = vi.hoisted(() => ({
  translate: vi.fn((key: string, _params?: Record<string, unknown>) => key),
  flowProps: { current: undefined as ComponentProps<typeof TReactFlow> | undefined },
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
    ReactFlow: (props: ComponentProps<typeof TReactFlow>) => {
      flowProps.current = props;
      return createElement(actual.ReactFlow, props);
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
    expect(edgeById("t:a").ariaLabel).toBe("Finish: Todo → Done");
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

  it("removes a deleted state without removing a transition it shared with another source", async () => {
    const onRemoveState = vi.fn();
    const onRemoveTransition = vi.fn();
    renderCanvas({
      draft: {
        states: [state("a", "Todo", 0, true), state("b", "Doing", 240), state("c", "Done", 480)],
        transitions: [
          { key: "t", name: "Finish", from_any: false, source_keys: ["a", "b"], target_key: "c", rules: [] },
        ],
      },
      onRemoveState,
      onRemoveTransition,
    });
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
