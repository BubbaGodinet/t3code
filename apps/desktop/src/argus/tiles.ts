import type { Placement, SurfaceTarget } from "./types.ts";

export type TileOrientation = "horizontal" | "vertical";

export interface TileLeaf {
  type: "leaf";
  id: string;
  surface: SurfaceTarget;
}

export interface TileSplit {
  type: "split";
  id: string;
  orientation: TileOrientation;
  sizes: number[];
  children: TileNode[];
}

export interface TileGrid {
  type: "grid";
  id: string;
  columns: 2 | 3;
  sizes: number[];
  children: TileNode[];
}

export type TileNode = TileLeaf | TileSplit | TileGrid;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function newTileId(prefix = "tile"): string {
  return `${prefix}:${Math.random().toString(36).slice(2, 10)}`;
}

export function flattenLeaves(node: TileNode | null | undefined): TileLeaf[] {
  if (!node) return [];
  if (node.type === "leaf") return [node];
  return node.children.flatMap((child) => flattenLeaves(child));
}

export function removeTile(root: TileNode | null, surfaceId: string): TileNode | null {
  if (!root) return null;
  if (root.type === "leaf") return root.id === surfaceId ? null : root;
  const children = root.children
    .map((child) => removeTile(child, surfaceId))
    .filter((child): child is TileNode => child !== null);
  if (children.length === 0) return null;
  if (children.length === 1) return children[0] ?? null;
  return { ...root, children, sizes: normalizeSizes(root.sizes, children.length) };
}

export function insertTile(root: TileNode | null, target: SurfaceTarget, placement: Placement): TileNode {
  const tree = removeTile(root, target.id);
  const leaf: TileLeaf = { type: "leaf", id: target.id, surface: target };
  const next = normalizePlacement(placement);
  if (!tree) return leaf;
  if (next === "grid") return toGrid(tree, leaf);
  const orientation: TileOrientation =
    next === "tile-top" || next === "tile-bottom" ? "vertical" : "horizontal";
  const before = next === "tile-left" || next === "tile-top";
  return wrap(tree, leaf, orientation, before);
}

export function resizeSplit(root: TileNode, splitId: string, sizes: number[]): TileNode {
  if (root.type === "leaf") return root;
  if (root.id === splitId) return { ...root, sizes: normalizeSizes(sizes, root.children.length) };
  return { ...root, children: root.children.map((child) => resizeSplit(child, splitId, sizes)) };
}

export function layoutTiles(node: TileNode, bounds: Rect): Array<{ id: string; surface: SurfaceTarget; bounds: Rect }> {
  if (node.type === "leaf") return [{ id: node.id, surface: node.surface, bounds }];
  if (node.type === "grid") {
    const columns = node.columns;
    const rows = Math.max(1, Math.ceil(node.children.length / columns));
    const cellW = bounds.width / columns;
    const cellH = bounds.height / rows;
    return node.children.flatMap((child, index) => {
      const col = index % columns;
      const row = Math.floor(index / columns);
      return layoutTiles(child, {
        x: bounds.x + col * cellW,
        y: bounds.y + row * cellH,
        width: cellW,
        height: cellH,
      });
    });
  }
  const sizes = normalizeSizes(node.sizes, node.children.length);
  let cursor = node.orientation === "horizontal" ? bounds.x : bounds.y;
  const span = node.orientation === "horizontal" ? bounds.width : bounds.height;
  return node.children.flatMap((child, index) => {
    const size = Math.round(span * (sizes[index] ?? 1 / node.children.length));
    const next =
      node.orientation === "horizontal"
        ? { x: cursor, y: bounds.y, width: size, height: bounds.height }
        : { x: bounds.x, y: cursor, width: bounds.width, height: size };
    cursor += size;
    return layoutTiles(child, next);
  });
}

export function parseTileNode(raw: unknown): TileNode | null {
  if (!raw || typeof raw !== "object") return null;
  const node = raw as TileNode;
  if (node.type === "leaf") {
    return typeof node.id === "string" && node.surface && typeof node.surface.href === "string" ? node : null;
  }
  if ((node.type === "split" || node.type === "grid") && Array.isArray(node.children)) {
    const children = node.children.map(parseTileNode).filter((child): child is TileNode => child !== null);
    if (children.length === 0) return null;
    return { ...node, children, sizes: normalizeSizes(node.sizes ?? [], children.length) };
  }
  return null;
}

export function normalizePlacement(placement: Placement): Placement {
  return placement === "split" ? "tile-right" : placement;
}

function wrap(tree: TileNode, leaf: TileLeaf, orientation: TileOrientation, before: boolean): TileNode {
  if (tree.type === "split" && tree.orientation === orientation) {
    const children = before ? [leaf, ...tree.children] : [...tree.children, leaf];
    return { ...tree, children, sizes: normalizeSizes(tree.sizes, children.length) };
  }
  return {
    type: "split",
    id: newTileId("split"),
    orientation,
    sizes: before ? [0.42, 0.58] : [0.58, 0.42],
    children: before ? [leaf, tree] : [tree, leaf],
  };
}

function toGrid(tree: TileNode, leaf: TileLeaf): TileGrid {
  const children = [...flattenLeaves(tree), leaf];
  return {
    type: "grid",
    id: newTileId("grid"),
    columns: children.length > 4 ? 3 : 2,
    sizes: children.map(() => 1 / children.length),
    children,
  };
}

function normalizeSizes(sizes: number[], count: number): number[] {
  const next = Array.from({ length: count }, (_, index) => {
    const value = sizes[index];
    return typeof value === "number" && value > 0 ? value : 1 / count;
  });
  const total = next.reduce((sum, value) => sum + value, 0) || 1;
  return next.map((value) => value / total);
}
