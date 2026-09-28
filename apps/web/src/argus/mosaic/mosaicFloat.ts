import type { MosaicRect } from "./mosaicTree";

/**
 * Geometry for panes popped out of the grid. A floating pane keeps its slot in
 * the split tree, so docking returns it exactly where it was; its window is a
 * rect in container percent so it scales with the grid.
 */
export type MosaicFloatRect = MosaicRect;

export const MIN_FLOAT_WIDTH = 18;
export const MIN_FLOAT_HEIGHT = 16;
const CASCADE_STEP = 3;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Keeps a floating window at least its minimum size and fully inside the grid. */
export function clampFloatRect(rect: MosaicFloatRect): MosaicFloatRect {
  const width = clamp(rect.width, MIN_FLOAT_WIDTH, 100);
  const height = clamp(rect.height, MIN_FLOAT_HEIGHT, 100);
  return {
    x: clamp(rect.x, 0, 100 - width),
    y: clamp(rect.y, 0, 100 - height),
    width,
    height,
  };
}

/**
 * Where a pane lands when it pops out: over its own slot, a little smaller so
 * the placeholder behind it stays visible, cascading past panes already out.
 */
export function initialFloatRect(slot: MosaicRect, floatingCount: number): MosaicFloatRect {
  const width = Math.max(slot.width * 0.7, 36);
  const height = Math.max(slot.height * 0.7, 36);
  const offset = CASCADE_STEP * (floatingCount + 1);
  return clampFloatRect({
    x: slot.x + (slot.width - width) / 2 + offset,
    y: slot.y + (slot.height - height) / 2 + offset,
    width,
    height,
  });
}

/** Moves a window by a delta in container percent. */
export function moveFloatRect(rect: MosaicFloatRect, dx: number, dy: number): MosaicFloatRect {
  return clampFloatRect({ ...rect, x: rect.x + dx, y: rect.y + dy });
}

/** Grows or shrinks a window from its bottom-right corner. */
export function resizeFloatRect(rect: MosaicFloatRect, dx: number, dy: number): MosaicFloatRect {
  const width = clamp(rect.width + dx, MIN_FLOAT_WIDTH, 100 - rect.x);
  const height = clamp(rect.height + dy, MIN_FLOAT_HEIGHT, 100 - rect.y);
  return { ...rect, width, height };
}
