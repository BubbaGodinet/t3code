import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { runArgusModeTransition } from "./argusModeTransition";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubWindow(reducedMotion: boolean) {
  vi.stubGlobal("window", {
    matchMedia: () => ({ matches: reducedMotion }),
    setTimeout,
    clearTimeout,
  });
}

describe("runArgusModeTransition", () => {
  it("marks the root only while it runs", async () => {
    stubWindow(false);
    const dataset: Record<string, string> = {};
    let finish: (() => void) | undefined;
    const finished = new Promise<void>((resolve) => (finish = resolve));
    let updateDone: (() => void) | undefined;
    const updated = new Promise<void>((resolve) => (updateDone = resolve));
    let seenDuringUpdate: string | undefined;
    vi.stubGlobal("document", {
      documentElement: { dataset },
      querySelector: () => ({}),
      startViewTransition: (update: () => Promise<void>) => {
        void update().then(updateDone);
        return { finished };
      },
    });

    const run = runArgusModeTransition("sanctuary", () => {
      seenDuringUpdate = dataset.argusModeTransition;
    });
    await updated;
    expect(seenDuringUpdate).toBe("reveal");
    expect(dataset.argusModeTransition).toBe("reveal");

    finish?.();
    await run;
    expect(dataset.argusModeTransition).toBeUndefined();
  });

  it("switches instantly under reduced motion", async () => {
    stubWindow(true);
    const dataset: Record<string, string> = {};
    const startViewTransition = vi.fn();
    vi.stubGlobal("document", { documentElement: { dataset }, startViewTransition });
    const update = vi.fn();

    await runArgusModeTransition("command", update);

    expect(update).toHaveBeenCalledOnce();
    expect(startViewTransition).not.toHaveBeenCalled();
    expect(dataset.argusModeTransition).toBeUndefined();
  });

  it("falls back to the view transition when the space being left could not be snapshotted", async () => {
    stubWindow(false);
    const dataset: Record<string, string> = {};
    const startViewTransition = vi.fn((update: () => Promise<void>) => ({
      finished: update(),
    }));
    vi.stubGlobal("document", {
      documentElement: { dataset },
      querySelector: () => ({}),
      startViewTransition,
    });
    const update = vi.fn();

    await runArgusModeTransition("sanctuary", update, Promise.resolve(null));

    expect(startViewTransition).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledOnce();
    expect(dataset.argusModeTransition).toBeUndefined();
  });

  it("does not wait on the snapshot under reduced motion", async () => {
    stubWindow(true);
    const dataset: Record<string, string> = {};
    vi.stubGlobal("document", { documentElement: { dataset } });
    const update = vi.fn();

    await runArgusModeTransition("sanctuary", update, new Promise(() => {}));

    expect(update).toHaveBeenCalledOnce();
  });

  it("marks the root while the knob slides, before the space changes", async () => {
    const dataset: Record<string, string> = {};
    let slide: (() => void) | undefined;
    vi.stubGlobal("window", {
      matchMedia: () => ({ matches: false }),
      setTimeout: (resolve: () => void) => {
        slide = resolve;
        return 0;
      },
      clearTimeout,
    });
    vi.stubGlobal("document", { documentElement: { dataset } });
    const update = vi.fn();

    const run = runArgusModeTransition("command", update, Promise.resolve(null), 200);
    await Promise.resolve();
    expect(dataset.argusModeTransition).toBe("reveal");
    expect(update).not.toHaveBeenCalled();

    slide?.();
    await run;
    expect(update).toHaveBeenCalledOnce();
    expect(dataset.argusModeTransition).toBeUndefined();
  });

  it("still switches when the view transition fails", async () => {
    stubWindow(false);
    const dataset: Record<string, string> = {};
    vi.stubGlobal("document", {
      documentElement: { dataset },
      startViewTransition: () => {
        throw new Error("unsupported");
      },
    });
    const update = vi.fn();

    await runArgusModeTransition("command", update);

    expect(update).toHaveBeenCalledOnce();
    expect(dataset.argusModeTransition).toBeUndefined();
  });
});
