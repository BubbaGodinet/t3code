export type Placement =
  | "page"
  | "split"
  | "tile-right"
  | "tile-left"
  | "tile-bottom"
  | "tile-top"
  | "grid"
  | "float";

export interface SurfaceTarget {
  id: string;
  kind: string;
  href: string;
  title: string;
  workspaceSlug?: string;
  provider?: string;
  threadId?: string;
}

export interface NativeViewRequest {
  id: string;
  href: string;
  kind: string;
  title: string;
  workspaceSlug?: string;
  bounds: { x: number; y: number; width: number; height: number };
}

export interface ThreadRequest {
  threadId: string;
  environmentId?: string;
  title: string;
  provider: string;
  href?: string;
  status?: string;
}
