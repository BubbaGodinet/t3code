import * as Fs from "node:fs";
import * as Path from "node:path";

import { parseTileNode, type TileNode } from "./tiles.ts";
import type { Placement, SurfaceTarget } from "./types.ts";

export type { Placement, SurfaceTarget };

export interface WorkspaceLayout {
  lastPlacement: Placement;
  tiles: TileNode | null;
  windows: Record<string, { x: number; y: number; width: number; height: number }>;
}

const empty = (): WorkspaceLayout => ({
  lastPlacement: "page",
  tiles: null,
  windows: {},
});

export class LayoutStore {
  constructor(private readonly file: string) {}

  read(workspaceSlug: string): WorkspaceLayout {
    try {
      const raw = JSON.parse(Fs.readFileSync(this.file, "utf8")) as Record<string, WorkspaceLayout>;
      return normalize(raw[workspaceSlug]);
    } catch {
      return empty();
    }
  }

  write(workspaceSlug: string, layout: WorkspaceLayout) {
    const all = this.readAll();
    all[workspaceSlug] = layout;
    Fs.mkdirSync(Path.dirname(this.file), { recursive: true });
    Fs.writeFileSync(this.file, JSON.stringify(all, null, 2));
  }

  private readAll(): Record<string, WorkspaceLayout> {
    try {
      return JSON.parse(Fs.readFileSync(this.file, "utf8")) as Record<string, WorkspaceLayout>;
    } catch {
      return {};
    }
  }
}

function normalize(value: WorkspaceLayout | undefined): WorkspaceLayout {
  if (!value) return empty();
  const last = value.lastPlacement === "split" ? "tile-right" : value.lastPlacement;
  return {
    lastPlacement: last ?? "page",
    tiles: parseTileNode(value.tiles) ?? null,
    windows: value.windows ?? {},
  };
}

export function layoutPath(userData: string): string {
  return Path.join(userData, "argus-layouts.json");
}
