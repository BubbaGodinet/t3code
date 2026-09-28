import { useMosaicStore } from "./mosaic/mosaicStore";

/** Message the Argus shell listens for on the frame's `window.parent`. */
export const ARGUS_SELECT_MODE_MESSAGE = "argus:select-mode";
export type ArgusMode = "command" | "sanctuary";

const EMBED_FLAG_KEY = "t3code:argus-embed";

export const ARGUS_HAS_PARENT = typeof window !== "undefined" && window.parent !== window;

/**
 * Argus frames T3 with `?argus=grid`. Routing drops the query, so the flag is
 * kept in this frame's session storage to survive in-frame reloads.
 */
function readArgusEmbedded(): boolean {
  if (!ARGUS_HAS_PARENT) return false;
  try {
    if (new URLSearchParams(window.location.search).get("argus") === "grid") {
      window.sessionStorage.setItem(EMBED_FLAG_KEY, "1");
      return true;
    }
    return window.sessionStorage.getItem(EMBED_FLAG_KEY) === "1";
  } catch {
    return false;
  }
}

export const ARGUS_EMBEDDED = readArgusEmbedded();

/**
 * The framing window's origin when the browser reveals it. Argus sends
 * `Referrer-Policy: same-origin`, which hides it (an empty referrer, a "null"
 * ancestor origin), so fall back to any origin: the message only names a mode.
 */
function parentOrigin(): string {
  for (const candidate of [window.location.ancestorOrigins?.[0], document.referrer]) {
    if (!candidate) continue;
    try {
      const origin = new URL(candidate).origin;
      if (origin !== "null") return origin;
    } catch {
      // Opaque or malformed; try the next source.
    }
  }
  return "*";
}

/** Asks the framing Argus window to switch modes. No-op outside a frame. */
export function selectArgusMode(mode: ArgusMode) {
  if (!ARGUS_HAS_PARENT) return;
  window.parent.postMessage({ type: ARGUS_SELECT_MODE_MESSAGE, mode }, parentOrigin());
}

/**
 * The Argus command-center view: the pane grid, or any page framed by Argus.
 * Its chrome carries the Argus mode switcher instead of T3 Code branding.
 */
export function useArgusCommandCenter(): boolean {
  const mosaicEnabled = useMosaicStore((state) => state.enabled);
  return mosaicEnabled || ARGUS_EMBEDDED;
}
