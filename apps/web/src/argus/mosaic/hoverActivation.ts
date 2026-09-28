import { isCommandPaletteOpen } from "../../commandPaletteBus";

/** Long enough that sweeping across a pane on the way elsewhere does not take focus. */
export const HOVER_ACTIVATE_DELAY_MS = 80;

/** Open menus, popovers, and dialogs; while one is up the pointer belongs to it. */
const OVERLAY_SELECTOR = [
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[role="menu"]',
  '[role="listbox"]',
  '[data-slot="menu-popup"]',
  '[data-slot="select-popup"]',
  '[data-slot="popover-popup"]',
  '[data-slot="combobox-popup"]',
  '[data-slot="autocomplete-popup"]',
].join(",");

let interactionDepth = 0;

/**
 * Held for the length of a pointer drag that owns the grid (gutter resize,
 * swap grip, floating move or resize). Returns the release.
 */
export function beginMosaicInteraction(): () => void {
  interactionDepth += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    interactionDepth -= 1;
  };
}

export function isMosaicInteracting(): boolean {
  return interactionDepth > 0;
}

export function isOverlayOpen(): boolean {
  return isCommandPaletteOpen() || document.querySelector(OVERLAY_SELECTOR) !== null;
}

export interface HoverActivationGuard {
  /** `PointerEvent.buttons`: non-zero while any button is held (a drag or selection). */
  readonly buttons: number;
  readonly interacting: boolean;
  readonly overlayOpen: boolean;
  readonly alreadyActive: boolean;
}

export function canHoverActivate(guard: HoverActivationGuard): boolean {
  return guard.buttons === 0 && !guard.interacting && !guard.overlayOpen && !guard.alreadyActive;
}

/**
 * Focus follows the pointer: resting on a pane for `delayMs` activates it.
 * `canActivate` is asked again when the delay ends, so a drag or menu that
 * started in the meantime still wins.
 */
export function createHoverActivator(options: {
  readonly delayMs: number;
  readonly canActivate: (paneId: string) => boolean;
  readonly activate: (paneId: string) => void;
}) {
  let pending: { readonly paneId: string; readonly timer: ReturnType<typeof setTimeout> } | null =
    null;

  const cancel = () => {
    if (pending === null) return;
    clearTimeout(pending.timer);
    pending = null;
  };

  return {
    /** Call on pointer movement over a pane. */
    hover(paneId: string, buttons: number) {
      if (buttons !== 0) {
        cancel();
        return;
      }
      if (pending?.paneId === paneId) return;
      cancel();
      const timer = setTimeout(() => {
        pending = null;
        if (options.canActivate(paneId)) options.activate(paneId);
      }, options.delayMs);
      pending = { paneId, timer };
    },
    leave(paneId: string) {
      if (pending?.paneId === paneId) cancel();
    },
    cancel,
  };
}
