import type {
  DevicePlatform,
  DeviceSummary,
  DiscoveredLocalServer,
  PreviewSessionSnapshot,
  ScopedThreadRef,
} from "@t3tools/contracts";

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
  /** The in-chat browser runs on the desktop app's embedded Chromium. */
  readonly inChatBrowserSupported: boolean;
}): ReadonlyArray<MosaicPlacementOption> {
  const chatReason =
    input.source?.kind !== "thread"
      ? "Only a started chat has a side panel. Send a message first."
      : input.kind === "browser" && !input.inChatBrowserSupported
        ? "The in-chat browser needs the T3 Code desktop app."
        : null;
  return [
    { placement: "chat", label: "In the chat", disabledReason: chatReason },
    { placement: "float", label: "Float above everything", disabledReason: null },
    { placement: "pane", label: "Own grid pane", disabledReason: null },
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

export type MosaicBrowserUrlSource = "pinned" | "preview" | "server" | "none";

/**
 * What the grid's browser shows for a session: a URL the user pinned in that
 * browser, else the page the thread's own preview is on, else a dev server
 * the session's terminals started (lowest port first).
 */
export function resolveSessionBrowserUrl(input: {
  readonly pinnedUrl: string | null;
  readonly activePreview: PreviewSessionSnapshot | null;
  readonly sessionServers: ReadonlyArray<Pick<DiscoveredLocalServer, "url" | "port">>;
}): { readonly url: string | null; readonly source: MosaicBrowserUrlSource } {
  if (input.pinnedUrl) return { url: input.pinnedUrl, source: "pinned" };
  const status = input.activePreview?.navStatus;
  if (status && status._tag !== "Idle") return { url: status.url, source: "preview" };
  const server = input.sessionServers.toSorted((left, right) => left.port - right.port)[0];
  if (server) return { url: server.url, source: "server" };
  return { url: null, source: "none" };
}

/**
 * Devices for the picker: iOS then Android, running devices first, then by
 * name and OS so same-named simulators on two runtimes stay in a steady order.
 */
export function groupDevicesForPicker<
  T extends Pick<DeviceSummary, "platform" | "name" | "version" | "booted">,
>(devices: ReadonlyArray<T>): ReadonlyArray<{ platform: DevicePlatform; devices: T[] }> {
  return (["ios", "android"] as const).flatMap((platform) => {
    const matching = devices
      .filter((device) => device.platform === platform)
      .toSorted(
        (left, right) =>
          Number(right.booted) - Number(left.booted) ||
          left.name.localeCompare(right.name) ||
          right.version.localeCompare(left.version, undefined, { numeric: true }),
      );
    return matching.length > 0 ? [{ platform, devices: matching }] : [];
  });
}

/** Accepts what a user types in an address bar: a full http(s) URL, `host:port`, or a bare port. */
export function normalizeTypedUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  const candidate = /^\d{2,5}$/.test(value)
    ? `http://localhost:${value}`
    : /^[a-z][a-z\d+.-]*:\/\//i.test(value)
      ? value
      : `http://${value}`;
  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}
