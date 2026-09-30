import type { ArgusMode } from "./argusCommandCenter";
import { playArgusReveal } from "./argusReveal";

/** How long the pill's selection slides before the space changes. Matches the knob's CSS. */
export const ARGUS_PILL_SLIDE_MS = 200;
/** Marks the in-app Sanctuary space, so a transition knows when it is on or off screen. */
export const ARGUS_SANCTUARY_SPACE_ATTRIBUTE = "data-argus-sanctuary";
/** Upper bound on waiting for the new space to commit before the transition captures it. */
const SPACE_COMMIT_TIMEOUT_MS = 1_000;

type ArgusViewTransitionDocument = Document & {
  startViewTransition?: (update: () => Promise<void>) => { readonly finished: Promise<void> };
};

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
 * Runs the change into `target` mode, after the pill's knob has slid for
 * `slideMs`. Both directions play the same transition. With a snapshot of the
 * space being left, it is the WebGL shader in `argusReveal.ts`; otherwise the
 * change runs inside a one-shot view transition that `index.css` animates.
 * Either way `data-argus-mode-transition` is set on the root element from the
 * moment the switch starts, which also holds Sanctuary's silk still. Reduced
 * motion switches instantly; no View Transitions support switches after the slide.
 */
export async function runArgusModeTransition(
  target: ArgusMode,
  update: () => void | Promise<void>,
  snapshot?: Promise<HTMLCanvasElement | null>,
  slideMs = 0,
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
  const committed = () => argusSpaceCommitted(target);
  const root = transitionDocument.documentElement;
  root.dataset.argusModeTransition = "reveal";
  try {
    const [image] = await Promise.all([
      snapshot,
      slideMs > 0 && new Promise((resolve) => window.setTimeout(resolve, slideMs)),
    ]);
    if (image) {
      try {
        if (await playArgusReveal(image, runUpdate, committed)) return;
      } catch {
        await runUpdate();
        return;
      }
    }

    if (!transitionDocument.startViewTransition) {
      await runUpdate();
      return;
    }
    try {
      const viewTransition = transitionDocument.startViewTransition(async () => {
        await runUpdate();
        await committed();
      });
      try {
        await viewTransition.finished;
      } catch {
        await runUpdate();
      }
    } catch {
      await runUpdate();
    }
  } finally {
    delete root.dataset.argusModeTransition;
  }
}
