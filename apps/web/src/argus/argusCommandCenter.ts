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

export type ArgusModeAction =
  /** This grid already is Command. */
  | { readonly kind: "grid" }
  /** Ask the framing Argus window to route, falling back to navigating the top window. */
  | { readonly kind: "frame"; readonly mode: ArgusMode; readonly url: string }
  /** No Argus around this page: open Argus's page like a link. */
  | { readonly kind: "open"; readonly url: string };

export interface ArgusModeTab {
  readonly mode: ArgusMode;
  readonly label: string;
  readonly selected: boolean;
  readonly action: ArgusModeAction;
}

/**
 * Both modes, always. Command is this grid; Sanctuary is an Argus page, so it
 * goes through the framing Argus window when there is one and opens Argus's
 * URL when there is not.
 */
export function argusModeTabs(input: {
  readonly inFrame: boolean;
  readonly argusOrigin: string;
}): ReadonlyArray<ArgusModeTab> {
  const sanctuaryUrl = new URL("/sanctuary", input.argusOrigin).toString();
  return [
    { mode: "command", label: "Command", selected: true, action: { kind: "grid" } },
    {
      mode: "sanctuary",
      label: "Sanctuary",
      selected: false,
      action: input.inFrame
        ? { kind: "frame", mode: "sanctuary", url: sanctuaryUrl }
        : { kind: "open", url: sanctuaryUrl },
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

export function runArgusModeAction(action: ArgusModeAction) {
  if (action.kind === "grid") {
    useMosaicStore.getState().setEnabled(true);
    return;
  }
  if (action.kind === "open") {
    openArgusUrl(action.url);
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

/**
 * The Argus command-center view: the pane grid, or any page framed by Argus.
 * Its chrome carries the Argus mode switcher instead of T3 Code branding.
 */
export function useArgusCommandCenter(): boolean {
  const mosaicEnabled = useMosaicStore((state) => state.enabled);
  return mosaicEnabled || ARGUS_EMBEDDED;
}
