import { useLocation } from "@tanstack/react-router";

import { readLocalApi } from "../localApi";
import { useMosaicStore } from "./mosaic/mosaicStore";

/** Message the Argus shell listens for on the frame's `window.parent`. */
export const ARGUS_SELECT_MODE_MESSAGE = "argus:select-mode";
/** Argus answers a mode message with this once it is routing, so the frame skips its fallback. */
export const ARGUS_SELECT_MODE_ACK = "argus:select-mode:ack";
export type ArgusMode = "command" | "sanctuary";

export const DEFAULT_ARGUS_ORIGIN = "http://localhost:3100";
const ACK_TIMEOUT_MS = 600;
const EMBED_FLAG_KEY = "t3code:argus-embed";
const ORIGIN_KEY = "t3code:argus-origin";

function isFramed(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    // Reading `top` only throws when a frame hides it, which still means framed.
    return true;
  }
}

export const ARGUS_IN_FRAME = typeof window !== "undefined" && isFramed();

function readSession(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSession(key: string, value: string) {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // Storage can be blocked in third-party frames; the query still worked for this load.
  }
}

/**
 * Argus frames T3 with `?argus=grid&argusOrigin=…`. Routing drops the query,
 * so both are kept in this frame's session storage to survive in-frame reloads.
 */
function readArgusEmbedded(): boolean {
  if (!ARGUS_IN_FRAME) return false;
  if (new URLSearchParams(window.location.search).get("argus") === "grid") {
    writeSession(EMBED_FLAG_KEY, "1");
    return true;
  }
  return readSession(EMBED_FLAG_KEY) === "1";
}

export const ARGUS_EMBEDDED = typeof window !== "undefined" && readArgusEmbedded();

export function normalizeArgusOrigin(candidate: string | null | undefined): string | null {
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

/**
 * Where Argus lives. The framing shell names itself in the query because its
 * `Referrer-Policy: same-origin` hides it from `document.referrer` and
 * `ancestorOrigins`; otherwise the local Argus default.
 */
function readArgusOrigin(): string {
  if (typeof window === "undefined") return DEFAULT_ARGUS_ORIGIN;
  const fromQuery = normalizeArgusOrigin(
    new URLSearchParams(window.location.search).get("argusOrigin"),
  );
  if (fromQuery) {
    writeSession(ORIGIN_KEY, fromQuery);
    return fromQuery;
  }
  return normalizeArgusOrigin(readSession(ORIGIN_KEY)) ?? DEFAULT_ARGUS_ORIGIN;
}

export const ARGUS_ORIGIN = readArgusOrigin();

/** The in-app Sanctuary page, used when no Argus window frames T3 (desktop, plain web). */
export const ARGUS_SANCTUARY_PATH = "/sanctuary";

export type ArgusModeAction =
  /** Command is the pane grid in this window. */
  | { readonly kind: "grid" }
  /** Ask the framing Argus window to route, falling back to navigating the top window. */
  | { readonly kind: "frame"; readonly mode: ArgusMode; readonly url: string }
  /** No Argus around this page: stay in this window on an app route. */
  | { readonly kind: "route"; readonly path: string };

export interface ArgusModeTab {
  readonly mode: ArgusMode;
  readonly label: string;
  readonly selected: boolean;
  readonly action: ArgusModeAction;
}

/**
 * Both modes, always. Command is this grid. Sanctuary goes through the framing
 * Argus window when there is one; otherwise it is an in-app page, so the
 * desktop app never hands it to the system browser.
 */
export function argusModeTabs(input: {
  readonly inFrame: boolean;
  readonly argusOrigin: string;
  readonly current: ArgusMode;
}): ReadonlyArray<ArgusModeTab> {
  return [
    {
      mode: "command",
      label: "Command",
      selected: input.current === "command",
      action: { kind: "grid" },
    },
    {
      mode: "sanctuary",
      label: "Sanctuary",
      selected: input.current === "sanctuary",
      action: input.inFrame
        ? {
            kind: "frame",
            mode: "sanctuary",
            url: new URL("/sanctuary", input.argusOrigin).toString(),
          }
        : { kind: "route", path: ARGUS_SANCTUARY_PATH },
    },
  ];
}

function openArgusUrl(url: string) {
  const api = readLocalApi();
  if (api) {
    void api.shell.openExternal(url).catch(() => window.open(url, "_blank", "noopener"));
    return;
  }
  window.open(url, "_blank", "noopener");
}

function navigateTop(url: string) {
  try {
    // Allowed cross-origin while the click's user activation is still live.
    window.top!.location.href = url;
  } catch {
    openArgusUrl(url);
  }
}

/** Where Command returns to after an in-app Sanctuary visit. */
let gridHrefBeforeSanctuary: string | null = null;

export function runArgusModeAction(
  action: ArgusModeAction,
  router: { readonly currentHref: string; readonly navigate: (href: string) => void },
) {
  const onSanctuary = router.currentHref.split(/[?#]/)[0] === ARGUS_SANCTUARY_PATH;
  if (action.kind === "grid") {
    useMosaicStore.getState().setEnabled(true);
    if (onSanctuary) router.navigate(gridHrefBeforeSanctuary ?? "/");
    return;
  }
  if (action.kind === "route") {
    if (onSanctuary) return;
    gridHrefBeforeSanctuary = router.currentHref;
    router.navigate(action.path);
    return;
  }
  const fallback = window.setTimeout(() => {
    window.removeEventListener("message", onAck);
    navigateTop(action.url);
  }, ACK_TIMEOUT_MS);
  function onAck(event: MessageEvent) {
    if (event.source !== window.parent) return;
    const data = event.data as { type?: unknown } | null;
    if (data?.type !== ARGUS_SELECT_MODE_ACK) return;
    window.clearTimeout(fallback);
    window.removeEventListener("message", onAck);
  }
  window.addEventListener("message", onAck);
  // Any origin: the message only names a mode, and a guessed origin that is off
  // by host or port (localhost vs 127.0.0.1) would make the browser drop it.
  window.parent.postMessage({ type: ARGUS_SELECT_MODE_MESSAGE, mode: action.mode }, "*");
}

/** Which Argus mode this window shows, or null outside the Argus command center. */
export function useArgusMode(): ArgusMode | null {
  const onSanctuary = useLocation({
    select: (location) => location.pathname === ARGUS_SANCTUARY_PATH,
  });
  const mosaicEnabled = useMosaicStore((state) => state.enabled);
  if (onSanctuary) return "sanctuary";
  return mosaicEnabled || ARGUS_EMBEDDED ? "command" : null;
}

/**
 * The Argus command-center view: the pane grid, in-app Sanctuary, or any page
 * framed by Argus. It drops T3 Code branding for the Argus mode pill at the window's top center.
 */
export function useArgusCommandCenter(): boolean {
  return useArgusMode() !== null;
}
