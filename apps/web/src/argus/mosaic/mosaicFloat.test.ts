import { describe, expect, it } from "vite-plus/test";

import {
  MIN_FLOAT_HEIGHT,
  MIN_FLOAT_WIDTH,
  initialFloatRect,
  moveFloatRect,
  resizeFloatRect,
} from "./mosaicFloat";
import { toggleFloatingPane } from "./mosaicStore";

const slot = { x: 50, y: 0, width: 50, height: 50 };

describe("toggleFloatingPane", () => {
  it("pops a pane out over its slot and docks it back on the second toggle", () => {
    const floated = toggleFloatingPane({}, "a", slot);
    expect(floated.a).toBeDefined();
    expect(toggleFloatingPane(floated, "a", slot)).toEqual({});
  });

  it("lets several panes float at once, cascading each new window", () => {
    const one = toggleFloatingPane({}, "a", slot);
    const two = toggleFloatingPane(one, "b", slot);
    expect(Object.keys(two)).toEqual(["a", "b"]);
    expect(two.b).not.toEqual(two.a);
    expect(toggleFloatingPane(two, "a", slot)).toEqual({ b: two.b });
  });
});

describe("floating window geometry", () => {
  it("opens inside the grid even from a slot at the edge", () => {
    const rect = initialFloatRect({ x: 90, y: 90, width: 10, height: 10 }, 4);
    expect(rect.x + rect.width).toBeLessThanOrEqual(100);
    expect(rect.y + rect.height).toBeLessThanOrEqual(100);
  });

  it("moves without leaving the grid", () => {
    const rect = { x: 10, y: 10, width: 40, height: 40 };
    expect(moveFloatRect(rect, 100, -100)).toEqual({ x: 60, y: 0, width: 40, height: 40 });
  });

  it("resizes from the corner within the grid and above the minimum size", () => {
    const rect = { x: 70, y: 10, width: 20, height: 20 };
    expect(resizeFloatRect(rect, 50, 5)).toMatchObject({ width: 30, height: 25 });
    expect(resizeFloatRect(rect, -50, -50)).toMatchObject({
      width: MIN_FLOAT_WIDTH,
      height: MIN_FLOAT_HEIGHT,
    });
  });
});
