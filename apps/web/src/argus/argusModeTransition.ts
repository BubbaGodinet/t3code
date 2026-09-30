import type { ArgusMode } from "./argusCommandCenter";
import { playArgusMelt } from "./argusMelt";

/** Command melts into Sanctuary; Sanctuary splits down the middle onto Command. */
export type ArgusModeTransition = "melt" | "split";

/** How long the pill's selection slides before the space changes. Matches the knob's CSS. */
export const ARGUS_PILL_SLIDE_MS = 200;
/** Marks the in-app Sanctuary space, so a transition knows when it is on or off screen. */
export const ARGUS_SANCTUARY_SPACE_ATTRIBUTE = "data-argus-sanctuary";
/** Upper bound on waiting for the new space to commit before the transition captures it. */
const SPACE_COMMIT_TIMEOUT_MS = 1_000;

type ArgusViewTransitionDocument = Document & {
  startViewTransition?: (update: () => Promise<void>) => { readonly finished: Promise<void> };
};

export function argusModeTransition(from: ArgusMode, to: ArgusMode): ArgusModeTransition | null {
  if (from === to) return null;
  return to === "sanctuary" ? "melt" : "split";
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

function sanctuaryOnScreen(): boolean {
  return document.querySelector(`[${ARGUS_SANCTUARY_SPACE_ATTRIBUTE}]`) !== null;
}

/** Resolves once the DOM shows `target`, so the view transition captures the new space. */
function argusSpaceCommitted(target: ArgusMode): Promise<void> {
  const committed = () => sanctuaryOnScreen() === (target === "sanctuary");
  if (committed()) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      observer.disconnect();
      window.clearTimeout(timeout);
      resolve();
    };
    const observer = new MutationObserver(() => {
      if (committed()) done();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    const timeout = window.setTimeout(done, SPACE_COMMIT_TIMEOUT_MS);
  });
}

/**
 * Runs the mode change. With a Command snapshot, the melt is the WebGL shader
 * in `argusMelt.ts`. Otherwise the change runs inside a one-shot view
 * transition, and `index.css` keys the melt or split off
 * `data-argus-mode-transition` on the root element, which is set for either
 * path. Reduced motion, or no View Transitions support, switches instantly.
 */
export async function runArgusModeTransition(
  transition: ArgusModeTransition,
  target: ArgusMode,
  update: () => void | Promise<void>,
  commandSnapshot?: Promise<HTMLCanvasElement | null>,
): Promise<void> {
  const transitionDocument = document as ArgusViewTransitionDocument;
  if (prefersReducedMotion()) {
    await update();
    return;
  }

  let updateStarted = false;
  const runUpdate = async () => {
    if (updateStarted) return;
    updateStarted = true;
    await update();
  };
  const root = transitionDocument.documentElement;

  const command = transition === "melt" ? await commandSnapshot : null;
  if (command) {
    root.dataset.argusModeTransition = transition;
    try {
      const melted = await playArgusMelt(command, runUpdate, () => argusSpaceCommitted(target));
      if (melted) return;
    } catch {
      await runUpdate();
      return;
    } finally {
      delete root.dataset.argusModeTransition;
    }
  }

  if (!transitionDocument.startViewTransition) {
    await runUpdate();
    return;
  }
  root.dataset.argusModeTransition = transition;
  try {
    const viewTransition = transitionDocument.startViewTransition(async () => {
      await runUpdate();
      await argusSpaceCommitted(target);
    });
    try {
      await viewTransition.finished;
    } catch {
      await runUpdate();
    }
  } catch {
    await runUpdate();
  } finally {
    delete root.dataset.argusModeTransition;
  }
}
