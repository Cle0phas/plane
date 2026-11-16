/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReadableFit } from "./workflow-canvas";

// The store is driven by hand so the real order of a change (props first, store later) can be replayed.
const { rf, fitView } = vi.hoisted(() => ({
  rf: {
    nodes: [] as { id: string }[],
    measured: true,
    width: 800,
    height: 600,
    zoom: 1,
  },
  fitView: vi.fn(),
}));

vi.mock("@xyflow/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@xyflow/react")>()),
  getViewportForBounds: () => ({ x: 0, y: 0, zoom: rf.zoom }),
  useNodesInitialized: () => rf.measured,
  useReactFlow: () => ({ fitView, getNodes: () => rf.nodes, getNodesBounds: () => ({}) }),
  useStore: (selector: (state: unknown) => unknown) => selector(rf),
}));

const START = { id: "__start__" };
const nodesOf = (...keys: string[]) => [START, ...keys.map((id) => ({ id }))];
const ALL = { padding: 0.2, maxZoom: 1 };

const fitProps = (list: string[]) => ({
  stateCount: list.length,
  startKeys: ["__start__", "a"],
  lastKey: list[list.length - 1],
});

const mountWith = (keys: string[]) => {
  rf.nodes = nodesOf(...keys);
  const view = render(<ReadableFit {...fitProps(keys)} />);
  // refresh re-renders with the current store, like a store update would.
  const refresh = (list: string[]) => view.rerender(<ReadableFit {...fitProps(list)} />);
  return {
    props: refresh,
    refresh,
    store: (list: string[], measured = true) => {
      rf.nodes = nodesOf(...list);
      rf.measured = measured;
    },
  };
};

describe("ReadableFit", () => {
  beforeEach(() => {
    fitView.mockClear();
    Object.assign(rf, { nodes: [], measured: true, width: 800, height: 600, zoom: 1 });
  });

  it("opens on the whole diagram when it fits at a readable size", () => {
    mountWith(["a", "b"]);
    expect(fitView).toHaveBeenCalledTimes(1);
    expect(fitView).toHaveBeenCalledWith(ALL);
  });

  it("opens on the start when the diagram is too large", () => {
    rf.zoom = 0.4;
    mountWith(["a", "b"]);
    expect(fitView).toHaveBeenCalledTimes(1);
    expect(fitView).toHaveBeenCalledWith({
      ...ALL,
      minZoom: 1,
      nodes: [{ id: "__start__" }, { id: "a" }],
    });
  });

  it("waits for a pane that has a size", () => {
    rf.width = 0;
    const view = mountWith(["a"]);
    expect(fitView).not.toHaveBeenCalled();
    rf.width = 800;
    view.refresh(["a"]);
    expect(fitView).toHaveBeenCalledTimes(1);
  });

  describe("when a state is added", () => {
    const addInRealOrder = (fits: boolean) => {
      rf.zoom = fits ? 1 : 0.4;
      const view = mountWith(["a", "b"]);
      fitView.mockClear();
      // 1. the component sees the new count while the store still holds the old nodes
      view.props(["a", "b", "c"]);
      expect(fitView).not.toHaveBeenCalled();
      // 2. the store holds the new node, not measured yet
      view.store(["a", "b", "c"], false);
      view.refresh(["a", "b", "c"]);
      expect(fitView).not.toHaveBeenCalled();
      // 3. measured
      view.store(["a", "b", "c"], true);
      view.refresh(["a", "b", "c"]);
    };

    it("follows it once, when everything does not fit", () => {
      rf.zoom = 0.4;
      addInRealOrder(false);
      expect(fitView).toHaveBeenCalledTimes(1);
      expect(fitView).toHaveBeenCalledWith({ ...ALL, minZoom: 1, nodes: [{ id: "c" }] });
    });

    it("shows everything once, when it still fits", () => {
      addInRealOrder(true);
      expect(fitView).toHaveBeenCalledTimes(1);
      expect(fitView).toHaveBeenCalledWith(ALL);
    });
  });

  describe("when a state is removed", () => {
    it("shows what remains when it fits", () => {
      const view = mountWith(["a", "b", "c"]);
      fitView.mockClear();
      view.props(["a", "b"]);
      expect(fitView).not.toHaveBeenCalled();
      view.store(["a", "b"]);
      view.refresh(["a", "b"]);
      expect(fitView).toHaveBeenCalledTimes(1);
      expect(fitView).toHaveBeenCalledWith(ALL);
    });

    it("keeps the view when what remains does not fit", () => {
      rf.zoom = 0.4;
      const view = mountWith(["a", "b", "c"]);
      fitView.mockClear();
      view.store(["a", "b"]);
      view.refresh(["a", "b"]);
      expect(fitView).not.toHaveBeenCalled();
    });
  });

  it("does not move the view when only the start node comes or goes", () => {
    const view = mountWith(["a", "b"]);
    fitView.mockClear();
    rf.nodes = [{ id: "a" }, { id: "b" }];
    view.refresh(["a", "b"]);
    rf.nodes = nodesOf("a", "b");
    rf.measured = false;
    view.refresh(["a", "b"]);
    rf.measured = true;
    view.refresh(["a", "b"]);
    expect(fitView).not.toHaveBeenCalled();
  });
});
