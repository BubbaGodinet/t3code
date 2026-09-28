import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  beginMosaicInteraction,
  canHoverActivate,
  createHoverActivator,
  isMosaicInteracting,
} from "./hoverActivation";

const idle = { buttons: 0, interacting: false, overlayOpen: false, alreadyActive: false };

describe("canHoverActivate", () => {
  it("activates a resting pointer over an inactive pane", () => {
    expect(canHoverActivate(idle)).toBe(true);
  });

  it("holds while a button is down, a drag owns the grid, a menu or dialog is open, or the pane is already active", () => {
    expect(canHoverActivate({ ...idle, buttons: 1 })).toBe(false);
    expect(canHoverActivate({ ...idle, interacting: true })).toBe(false);
    expect(canHoverActivate({ ...idle, overlayOpen: true })).toBe(false);
    expect(canHoverActivate({ ...idle, alreadyActive: true })).toBe(false);
  });
});

describe("beginMosaicInteraction", () => {
  it("counts overlapping drags and releases each once", () => {
    const first = beginMosaicInteraction();
    const second = beginMosaicInteraction();
    first();
    first();
    expect(isMosaicInteracting()).toBe(true);
    second();
    expect(isMosaicInteracting()).toBe(false);
  });
});

describe("createHoverActivator", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function setup(canActivate: (paneId: string) => boolean = () => true) {
    const activate = vi.fn<(paneId: string) => void>();
    const activator = createHoverActivator({ delayMs: 80, canActivate, activate });
    return { activate, activator };
  }

  it("activates a pane after the pointer rests on it for the delay", () => {
    const { activate, activator } = setup();
    activator.hover("a", 0);
    vi.advanceTimersByTime(79);
    activator.hover("a", 0);
    expect(activate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(activate).toHaveBeenCalledExactlyOnceWith("a");
  });

  it("does not activate panes the pointer only passes over", () => {
    const { activate, activator } = setup();
    activator.hover("a", 0);
    vi.advanceTimersByTime(40);
    activator.leave("a");
    activator.hover("b", 0);
    vi.advanceTimersByTime(80);
    expect(activate).toHaveBeenCalledExactlyOnceWith("b");
  });

  it("drops a pending activation when a button goes down", () => {
    const { activate, activator } = setup();
    activator.hover("a", 0);
    activator.hover("a", 1);
    vi.advanceTimersByTime(200);
    expect(activate).not.toHaveBeenCalled();
  });

  it("asks the guard again when the delay ends", () => {
    let blocked = false;
    const { activate, activator } = setup(() => !blocked);
    activator.hover("a", 0);
    blocked = true;
    vi.advanceTimersByTime(80);
    expect(activate).not.toHaveBeenCalled();
  });
});
