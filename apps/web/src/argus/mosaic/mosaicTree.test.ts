import { describe, expect, it } from "vite-plus/test";

import {
  arrangementOf,
  buildArrangementTree,
  buildPresetTree,
  collectPaneIds,
  dropZoneAt,
  gridColumnCount,
  insertPaneBeside,
  layoutMosaic,
  MIN_PANE_PERCENT,
  movePane,
  nextArrangement,
  removePane,
  resizeSplit,
  swapPanes,
  type MosaicArrangement,
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

describe("layout cycle", () => {
  it("advances columns, rows, grid, then columns", () => {
    expect(nextArrangement(null)).toBe("columns");
    expect(nextArrangement("columns")).toBe("rows");
    expect(nextArrangement("rows")).toBe("grid");
    expect(nextArrangement("grid")).toBe("columns");
  });

  it("uses two columns for 2–4 panes and widens toward a square after that", () => {
    expect(gridColumnCount(1)).toBe(1);
    expect(gridColumnCount(2)).toBe(2);
    expect(gridColumnCount(3)).toBe(2);
    expect(gridColumnCount(4)).toBe(2);
    expect(gridColumnCount(5)).toBe(3);
    expect(gridColumnCount(9)).toBe(3);
    expect(gridColumnCount(10)).toBe(4);
  });

  it("rearranges the same panes and loops back to columns", () => {
    const ids = ["chat", "term", "browser", "draft", "phone"];
    let root: MosaicNode | null = buildPresetTree("two-over-one", ids, idFactory());
    const seen: MosaicArrangement[] = [];
    for (let step = 0; step < 4; step += 1) {
      const next = nextArrangement(arrangementOf(root));
      seen.push(next);
      root = buildArrangementTree(next, collectPaneIds(root), idFactory());
      expect(collectPaneIds(root)).toEqual(ids);
    }
    expect(seen).toEqual(["columns", "rows", "grid", "columns"]);
    expect(arrangementOf(root)).toBe("columns");
  });

  it("lays columns in one row, rows in one stack, and a square grid", () => {
    const columns = layoutMosaic(buildArrangementTree("columns", ["a", "b", "c"], idFactory()));
    expect(columns.panes.map(({ rect }) => Math.round(rect.width))).toEqual([33, 33, 33]);
    expect(columns.panes.every(({ rect }) => rect.y === 0 && rect.height === 100)).toBe(true);

    const rows = layoutMosaic(buildArrangementTree("rows", ["a", "b", "c"], idFactory()));
    expect(rows.panes.map(({ rect }) => Math.round(rect.height))).toEqual([33, 33, 33]);
    expect(rows.panes.every(({ rect }) => rect.x === 0 && rect.width === 100)).toBe(true);

    const grid = layoutMosaic(buildArrangementTree("grid", ["a", "b", "c", "d", "e"], idFactory()));
    expect(grid.panes.map(({ rect }) => Math.round(rect.width))).toEqual([33, 33, 33, 50, 50]);
    expect(grid.panes.every(({ rect }) => rect.height === 50)).toBe(true);
    expect(arrangementOf(buildArrangementTree("grid", ["a", "b", "c"], idFactory()))).toBe("grid");
    expect(
      arrangementOf(buildPresetTree("three-over-two", ["a", "b", "c", "d"], idFactory())),
    ).toBe(null);
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

describe("swapPanes", () => {
  it("trades two panes across splits while each slot keeps its size", () => {
    const tree = resizeSplit(
      buildPresetTree("two-over-one", ["a", "b", "c"], idFactory()),
      "split-0",
      0,
      20,
    );
    const swapped = swapPanes(tree, "a", "c");
    const rects = Object.fromEntries(
      layoutMosaic(swapped).panes.map(({ paneId, rect }) => [paneId, rect]),
    );
    expect(rects.c).toEqual({ x: 0, y: 0, width: 70, height: 50 });
    expect(rects.a).toEqual({ x: 0, y: 50, width: 100, height: 50 });
    expect(rects.b).toEqual({ x: 70, y: 0, width: 30, height: 50 });
  });

  it("leaves the tree alone for the same pane or an unknown pane", () => {
    const tree = buildPresetTree("grid-2x2", ["a", "b"], idFactory());
    expect(swapPanes(tree, "a", "a")).toBe(tree);
    expect(swapPanes(tree, "a", "missing")).toBe(tree);
  });
});

describe("dropZoneAt", () => {
  it("swaps in the middle and splits toward the nearest edge", () => {
    expect(dropZoneAt(0.5, 0.5)).toBe("center");
    expect(dropZoneAt(0.3, 0.7)).toBe("center");
    expect(dropZoneAt(0.1, 0.5)).toBe("left");
    expect(dropZoneAt(0.9, 0.4)).toBe("right");
    expect(dropZoneAt(0.5, 0.1)).toBe("top");
    expect(dropZoneAt(0.6, 0.95)).toBe("bottom");
    expect(dropZoneAt(0.05, 0.2)).toBe("left");
    expect(dropZoneAt(0.2, 0.05)).toBe("top");
  });
});

describe("movePane", () => {
  const rectsOf = (tree: MosaicNode | null) =>
    Object.fromEntries(layoutMosaic(tree).panes.map(({ paneId, rect }) => [paneId, rect]));

  it("swaps the two panes when dropped on the center", () => {
    const tree = buildPresetTree("two-over-one", ["a", "b", "c"], idFactory());
    expect(movePane(tree, "a", "c", "center", idFactory())).toEqual(swapPanes(tree, "a", "c"));
  });

  it("splits the target side by side for left and right, collapsing the old slot", () => {
    const tree = buildPresetTree("two-over-one", ["a", "b", "c"], idFactory());
    const left = rectsOf(movePane(tree, "a", "c", "left", idFactory()));
    expect(left).toEqual({
      b: { x: 0, y: 0, width: 100, height: 50 },
      a: { x: 0, y: 50, width: 50, height: 50 },
      c: { x: 50, y: 50, width: 50, height: 50 },
    });
    const right = rectsOf(movePane(tree, "a", "c", "right", idFactory()));
    expect(right.c).toEqual({ x: 0, y: 50, width: 50, height: 50 });
    expect(right.a).toEqual({ x: 50, y: 50, width: 50, height: 50 });
  });

  it("splits the target stacked for top and bottom", () => {
    const tree = buildPresetTree("grid-2x2", ["a", "b"], idFactory());
    const top = rectsOf(movePane(tree, "a", "b", "top", idFactory()));
    expect(top).toEqual({
      a: { x: 0, y: 0, width: 100, height: 50 },
      b: { x: 0, y: 50, width: 100, height: 50 },
    });
    const bottom = rectsOf(movePane(tree, "a", "b", "bottom", idFactory()));
    expect(bottom.b).toEqual({ x: 0, y: 0, width: 100, height: 50 });
    expect(bottom.a).toEqual({ x: 0, y: 50, width: 100, height: 50 });
  });

  it("halves the target's share when its row already splits that way", () => {
    const tree = buildPresetTree("three-over-two", ["a", "b", "c", "d", "e"], idFactory());
    const next = movePane(tree, "d", "b", "right", idFactory());
    expect(collectPaneIds(next)).toEqual(["a", "b", "d", "c", "e"]);
    const rects = rectsOf(next);
    expect(rects.b!.width).toBeCloseTo(100 / 6);
    expect(rects.d!.width).toBeCloseTo(100 / 6);
    expect(rects.e).toEqual({ x: 0, y: 50, width: 100, height: 50 });
  });

  it("leaves the tree alone for the same pane or an unknown pane", () => {
    const tree = buildPresetTree("grid-2x2", ["a", "b"], idFactory());
    expect(movePane(tree, "a", "a", "left", idFactory())).toBe(tree);
    expect(movePane(tree, "a", "missing", "top", idFactory())).toBe(tree);
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
