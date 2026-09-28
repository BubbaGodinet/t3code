/**
 * Split-tree model for the Argus pane mosaic. A split lays its children out
 * side by side (`row`) or stacked (`column`) with percentage sizes that sum
 * to 100, so arrangements like "two on top, one spanning the bottom" or
 * "three on top, two below" are plain nested splits.
 */
export type MosaicDirection = "row" | "column";

export type MosaicNode =
  | { readonly kind: "pane"; readonly paneId: string }
  | {
      readonly kind: "split";
      readonly id: string;
      readonly direction: MosaicDirection;
      readonly children: ReadonlyArray<MosaicNode>;
      readonly sizes: ReadonlyArray<number>;
    };

export type MosaicPreset = "row" | "two-over-one" | "grid-2x2" | "three-over-two";

export interface MosaicRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface MosaicDivider {
  readonly splitId: string;
  /** The divider sits between child `index` and child `index + 1`. */
  readonly index: number;
  readonly direction: MosaicDirection;
  /** The split's own rect, needed to turn pointer deltas into percentages. */
  readonly splitRect: MosaicRect;
  /** Offset along the split axis, in container percent. */
  readonly position: number;
}

export const MIN_PANE_PERCENT = 8;

export function paneLeaf(paneId: string): MosaicNode {
  return { kind: "pane", paneId };
}

export function splitNode(
  id: string,
  direction: MosaicDirection,
  children: ReadonlyArray<MosaicNode>,
  sizes?: ReadonlyArray<number>,
): MosaicNode {
  return {
    kind: "split",
    id,
    direction,
    children,
    sizes: sizes ?? children.map(() => 100 / children.length),
  };
}

export function collectPaneIds(node: MosaicNode | null): string[] {
  if (node === null) return [];
  if (node.kind === "pane") return [node.paneId];
  return node.children.flatMap((child) => collectPaneIds(child));
}

/** How many panes each preset holds, top row first. */
export function presetRows(preset: MosaicPreset): ReadonlyArray<number> {
  switch (preset) {
    case "row":
      return [1];
    case "two-over-one":
      return [2, 1];
    case "grid-2x2":
      return [2, 2];
    case "three-over-two":
      return [3, 2];
  }
}

/**
 * Lays `paneIds` into a preset's rows. Panes beyond the preset's capacity
 * join the last row so switching presets never drops a pane.
 */
export function buildPresetTree(
  preset: MosaicPreset,
  paneIds: ReadonlyArray<string>,
  newId: () => string,
): MosaicNode | null {
  if (paneIds.length === 0) return null;
  const rowCounts = presetRows(preset);
  const rows: string[][] = [];
  let cursor = 0;
  for (const count of rowCounts) {
    if (cursor >= paneIds.length) break;
    rows.push(paneIds.slice(cursor, cursor + count));
    cursor += count;
  }
  if (cursor < paneIds.length) {
    rows[rows.length - 1]!.push(...paneIds.slice(cursor));
  }
  const rowNodes = rows.map((ids) =>
    ids.length === 1 ? paneLeaf(ids[0]!) : splitNode(newId(), "row", ids.map(paneLeaf)),
  );
  return rowNodes.length === 1 ? rowNodes[0]! : splitNode(newId(), "column", rowNodes);
}

/**
 * Puts `newPaneId` next to `targetPaneId`. When the target's parent already
 * splits in `direction`, the new pane joins that split and takes half of the
 * target's share; otherwise the target becomes a two-way split.
 */
export function insertPaneBeside(
  root: MosaicNode | null,
  targetPaneId: string | null,
  newPaneId: string,
  direction: MosaicDirection,
  newId: () => string,
): MosaicNode {
  if (root === null) return paneLeaf(newPaneId);
  const target =
    targetPaneId !== null && collectPaneIds(root).includes(targetPaneId)
      ? targetPaneId
      : collectPaneIds(root).at(-1)!;

  const visit = (node: MosaicNode): MosaicNode => {
    if (node.kind === "pane") {
      if (node.paneId !== target) return node;
      return splitNode(newId(), direction, [node, paneLeaf(newPaneId)]);
    }
    const index = node.children.findIndex(
      (child) => child.kind === "pane" && child.paneId === target,
    );
    if (index !== -1 && node.direction === direction) {
      const half = node.sizes[index]! / 2;
      const children = [...node.children];
      children.splice(index + 1, 0, paneLeaf(newPaneId));
      const sizes = [...node.sizes];
      sizes.splice(index, 1, half, half);
      return { ...node, children, sizes };
    }
    return { ...node, children: node.children.map(visit) };
  };
  return visit(root);
}

/**
 * Removes a pane. A split left with one child collapses into it, and a
 * collapsed child that splits the same way as its new parent is flattened in.
 */
export function removePane(root: MosaicNode | null, paneId: string): MosaicNode | null {
  if (root === null) return null;
  if (root.kind === "pane") return root.paneId === paneId ? null : root;

  const children: MosaicNode[] = [];
  const sizes: number[] = [];
  root.children.forEach((child, index) => {
    const next = removePane(child, paneId);
    if (next === null) return;
    const size = root.sizes[index]!;
    if (next.kind === "split" && next.direction === root.direction && next !== child) {
      next.children.forEach((grandchild, grandIndex) => {
        children.push(grandchild);
        sizes.push((size * next.sizes[grandIndex]!) / 100);
      });
      return;
    }
    children.push(next);
    sizes.push(size);
  });

  if (children.length === 0) return null;
  if (children.length === 1) return children[0]!;
  const total = sizes.reduce((sum, size) => sum + size, 0);
  return { ...root, children, sizes: sizes.map((size) => (size / total) * 100) };
}

/**
 * Moves the divider between child `index` and `index + 1` of `splitId` by
 * `deltaPercent` of that split's extent, keeping both neighbours above the
 * minimum size.
 */
export function resizeSplit(
  root: MosaicNode | null,
  splitId: string,
  index: number,
  deltaPercent: number,
): MosaicNode | null {
  if (root === null || root.kind === "pane") return root;
  if (root.id !== splitId) {
    return {
      ...root,
      children: root.children.map((child) => resizeSplit(child, splitId, index, deltaPercent)!),
    };
  }
  const before = root.sizes[index];
  const after = root.sizes[index + 1];
  if (before === undefined || after === undefined) return root;
  const pair = before + after;
  const nextBefore = Math.min(
    pair - MIN_PANE_PERCENT,
    Math.max(MIN_PANE_PERCENT, before + deltaPercent),
  );
  const sizes = [...root.sizes];
  sizes[index] = nextBefore;
  sizes[index + 1] = pair - nextBefore;
  return { ...root, sizes };
}

/** Flattens the tree into container-percent rects for panes and dividers. */
export function layoutMosaic(root: MosaicNode | null): {
  panes: ReadonlyArray<{ paneId: string; rect: MosaicRect }>;
  dividers: ReadonlyArray<MosaicDivider>;
} {
  const panes: Array<{ paneId: string; rect: MosaicRect }> = [];
  const dividers: MosaicDivider[] = [];
  const visit = (node: MosaicNode, rect: MosaicRect) => {
    if (node.kind === "pane") {
      panes.push({ paneId: node.paneId, rect });
      return;
    }
    const horizontal = node.direction === "row";
    const extent = horizontal ? rect.width : rect.height;
    let offset = horizontal ? rect.x : rect.y;
    node.children.forEach((child, index) => {
      const size = (extent * node.sizes[index]!) / 100;
      visit(
        child,
        horizontal
          ? { x: offset, y: rect.y, width: size, height: rect.height }
          : { x: rect.x, y: offset, width: rect.width, height: size },
      );
      offset += size;
      if (index < node.children.length - 1) {
        dividers.push({
          splitId: node.id,
          index,
          direction: node.direction,
          splitRect: rect,
          position: offset,
        });
      }
    });
  };
  if (root !== null) visit(root, { x: 0, y: 0, width: 100, height: 100 });
  return { panes, dividers };
}
