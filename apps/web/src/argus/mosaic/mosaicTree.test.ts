import { describe, expect, it } from "vite-plus/test";

import {
  buildPresetTree,
  collectPaneIds,
  insertPaneBeside,
  layoutMosaic,
  MIN_PANE_PERCENT,
  removePane,
  resizeSplit,
  type MosaicNode,
} from "./mosaicTree";

function idFactory() {
  let next = 0;
  return () => `split-${next++}`;
}

describe("buildPresetTree", () => {
  it("lays out two on top and one spanning the bottom", () => {
    const tree = buildPresetTree("two-over-one", ["a", "b", "c"], idFactory());
    const { panes } = layoutMosaic(tree);
    expect(panes).toEqual([
      { paneId: "a", rect: { x: 0, y: 0, width: 50, height: 50 } },
      { paneId: "b", rect: { x: 50, y: 0, width: 50, height: 50 } },
      { paneId: "c", rect: { x: 0, y: 50, width: 100, height: 50 } },
    ]);
  });

  it("lays out three on top and two below", () => {
    const tree = buildPresetTree("three-over-two", ["a", "b", "c", "d", "e"], idFactory());
    const widths = layoutMosaic(tree).panes.map(({ rect }) => Math.round(rect.width));
    expect(widths).toEqual([33, 33, 33, 50, 50]);
  });

  it("keeps extra panes in the last row instead of dropping them", () => {
    const tree = buildPresetTree("grid-2x2", ["a", "b", "c", "d", "e"], idFactory());
    expect(collectPaneIds(tree)).toEqual(["a", "b", "c", "d", "e"]);
  });
});

describe("insertPaneBeside", () => {
  it("joins a same-direction parent and splits the target's share", () => {
    const newId = idFactory();
    const row = buildPresetTree("grid-2x2", ["a", "b"], newId);
    const next = insertPaneBeside(row, "a", "c", "row", newId);
    expect(collectPaneIds(next)).toEqual(["a", "c", "b"]);
    expect(next.kind === "split" && next.sizes).toEqual([25, 25, 50]);
  });

  it("nests a new split when the direction differs", () => {
    const newId = idFactory();
    const row = buildPresetTree("grid-2x2", ["a", "b"], newId);
    const next = insertPaneBeside(row, "b", "c", "column", newId);
    const { panes } = layoutMosaic(next);
    expect(panes.find((pane) => pane.paneId === "c")?.rect).toEqual({
      x: 50,
      y: 50,
      width: 50,
      height: 50,
    });
  });
});

describe("removePane", () => {
  it("collapses single-child splits and flattens same-direction children", () => {
    const newId = idFactory();
    const tree: MosaicNode = {
      kind: "split",
      id: "root",
      direction: "row",
      sizes: [50, 50],
      children: [
        { kind: "pane", paneId: "a" },
        {
          kind: "split",
          id: "col",
          direction: "column",
          sizes: [50, 50],
          children: [
            { kind: "pane", paneId: "b" },
            buildPresetTree("grid-2x2", ["c", "d"], newId)!,
          ],
        },
      ],
    };
    const next = removePane(tree, "b");
    expect(next?.kind === "split" && next.direction).toBe("row");
    expect(collectPaneIds(next)).toEqual(["a", "c", "d"]);
    expect(next?.kind === "split" && next.sizes).toEqual([50, 25, 25]);
    expect(removePane(removePane(removePane(next, "a"), "c"), "d")).toBeNull();
  });
});

describe("resizeSplit", () => {
  it("moves one divider and clamps both neighbours to the minimum", () => {
    const tree = buildPresetTree("grid-2x2", ["a", "b"], () => "row");
    const grown = resizeSplit(tree, "row", 0, 20);
    expect(grown?.kind === "split" && grown.sizes).toEqual([70, 30]);
    const clamped = resizeSplit(tree, "row", 0, 200);
    expect(clamped?.kind === "split" && clamped.sizes).toEqual([
      100 - MIN_PANE_PERCENT,
      MIN_PANE_PERCENT,
    ]);
  });
});
