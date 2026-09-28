import type { DiscoveredLocalServer, ScopedThreadRef } from "@t3tools/contracts";

import { initialFloatRect, type MosaicFloatRect } from "./mosaicFloat";
import type { MosaicPane } from "./mosaicStore";
import { collectPaneIds, insertPaneBeside, type MosaicNode, type MosaicRect } from "./mosaicTree";

/**
 * A browser or device opened from a pane follows that pane's session: a chat's
 * server thread (which also has T3's in-chat side panel) or a terminal pane's
 * session, which is keyed like a thread on the server but has no side panel.
 */
export type MosaicSurfaceSource =
  | { readonly kind: "thread"; readonly threadRef: ScopedThreadRef }
  | { readonly kind: "terminal"; readonly threadRef: ScopedThreadRef };

export type MosaicSurfaceKind = "browser" | "device";

/**
 * Where a browser or device opens: in the chat's own side panel, in a window
 * floating over the whole grid, or as its own grid pane.
 */
export type MosaicSurfacePlacement = "chat" | "float" | "pane";

export interface MosaicPlacementOption {
  readonly placement: MosaicSurfacePlacement;
  readonly label: string;
  /** Why this placement cannot be used from this pane, or null when it can. */
  readonly disabledReason: string | null;
}

/** The three placements, in menu order, with a reason when one is not available here. */
export function surfacePlacementOptions(input: {
  readonly kind: MosaicSurfaceKind;
  readonly source: MosaicSurfaceSource | null;
  /** T3's browser runs on the desktop app's embedded Chromium, wherever it is placed. */
  readonly browserSupported: boolean;
}): ReadonlyArray<MosaicPlacementOption> {
  const runtimeReason =
    input.kind === "browser" && !input.browserSupported
      ? "The browser needs the T3 Code desktop app."
      : null;
  const chatReason =
    input.source?.kind !== "thread"
      ? "Only a started chat has a side panel. Send a message first."
      : runtimeReason;
  return [
    { placement: "chat", label: "In the chat", disabledReason: chatReason },
    { placement: "float", label: "Float above everything", disabledReason: runtimeReason },
    { placement: "pane", label: "Own grid pane", disabledReason: runtimeReason },
  ];
}

interface SurfaceLayout {
  readonly panes: Readonly<Record<string, MosaicPane>>;
  readonly root: MosaicNode | null;
  readonly floating: Readonly<Record<string, MosaicFloatRect>>;
  readonly activePaneId: string | null;
}

const WHOLE_GRID: MosaicRect = { x: 0, y: 0, width: 100, height: 100 };

/**
 * Adds a browser or device pane. `pane` joins the grid beside the pane it was
 * opened from; `float` opens a window over the grid that holds no grid slot,
 * cascading from the origin pane so it lands near what it belongs to.
 */
export function placeSurfacePane(
  layout: SurfaceLayout,
  pane: MosaicPane,
  placement: Exclude<MosaicSurfacePlacement, "chat">,
  origin: { readonly paneId: string | null; readonly slot: MosaicRect | null },
  newId: () => string,
): SurfaceLayout {
  const panes = { ...layout.panes, [pane.id]: pane };
  if (placement === "pane") {
    return {
      ...layout,
      panes,
      root: insertPaneBeside(layout.root, origin.paneId, pane.id, "row", newId),
      activePaneId: pane.id,
    };
  }
  return {
    ...layout,
    panes,
    floating: {
      ...layout.floating,
      [pane.id]: initialFloatRect(origin.slot ?? WHOLE_GRID, Object.keys(layout.floating).length),
    },
    activePaneId: pane.id,
  };
}

/** Floating panes that hold no slot in the grid, in a stable order. */
export function detachedFloatingPaneIds(
  layout: Pick<SurfaceLayout, "panes" | "root" | "floating">,
): string[] {
  const inGrid = new Set(collectPaneIds(layout.root));
  return Object.keys(layout.floating)
    .filter((paneId) => !inGrid.has(paneId) && layout.panes[paneId] !== undefined)
    .toSorted();
}

/** The grid pane showing `source`'s chat or terminal, so a docked surface lands beside it. */
export function findSourcePaneId(
  layout: Pick<SurfaceLayout, "panes" | "root">,
  source: MosaicSurfaceSource | null,
): string | null {
  if (!source) return null;
  const { environmentId, threadId } = source.threadRef;
  return (
    collectPaneIds(layout.root).find((paneId) => {
      const pane = layout.panes[paneId];
      if (source.kind === "thread") {
        return (
          pane?.kind === "chat" &&
          pane.target?.kind === "server" &&
          pane.target.threadRef.environmentId === environmentId &&
          pane.target.threadRef.threadId === threadId
        );
      }
      return pane?.kind === "terminal" && pane.sessionThreadId === threadId;
    }) ?? null
  );
}

/**
 * The browser or device pane already open for `source`, in the grid or floating.
 * A session's browser is one webview, so a second placement moves this pane.
 */
export function findSurfacePaneId(
  layout: Pick<SurfaceLayout, "panes">,
  kind: MosaicSurfaceKind,
  source: MosaicSurfaceSource | null,
): string | null {
  if (!source) return null;
  const { environmentId, threadId } = source.threadRef;
  return (
    Object.values(layout.panes).find(
      (pane) =>
        pane.kind === kind &&
        pane.source?.kind === source.kind &&
        pane.source.threadRef.environmentId === environmentId &&
        pane.source.threadRef.threadId === threadId,
    )?.id ?? null
  );
}

/**
 * Docks a floating pane. One popped out of the grid returns to its slot; one
 * that floated from the start joins the grid beside `besidePaneId`.
 */
export function dockFloatingPane(
  layout: SurfaceLayout,
  paneId: string,
  besidePaneId: string | null,
  newId: () => string,
): SurfaceLayout {
  if (!layout.floating[paneId]) return layout;
  const { [paneId]: _docked, ...floating } = layout.floating;
  const inGrid = collectPaneIds(layout.root).includes(paneId);
  return {
    ...layout,
    floating,
    root: inGrid ? layout.root : insertPaneBeside(layout.root, besidePaneId, paneId, "row", newId),
  };
}

/**
 * The page a session's browser opens when it has no tab yet: the URL a saved
 * pane kept, else the lowest-port dev server the session's terminals started.
 */
export function sessionBrowserStartUrl(input: {
  readonly pinnedUrl: string | null;
  readonly sessionServers: ReadonlyArray<Pick<DiscoveredLocalServer, "url" | "port">>;
}): string | null {
  if (input.pinnedUrl) return input.pinnedUrl;
  return input.sessionServers.toSorted((left, right) => left.port - right.port)[0]?.url ?? null;
}
