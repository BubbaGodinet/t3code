import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { argusModeTransition, runArgusModeTransition } from "./argusModeTransition";

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

describe("argusModeTransition", () => {
  it("melts Command into Sanctuary and splits Sanctuary open onto Command", () => {
    expect(argusModeTransition("command", "sanctuary")).toBe("melt");
    expect(argusModeTransition("sanctuary", "command")).toBe("split");
  });

  it("does not animate staying in the same mode", () => {
    expect(argusModeTransition("command", "command")).toBeNull();
    expect(argusModeTransition("sanctuary", "sanctuary")).toBeNull();
  });
});

describe("runArgusModeTransition", () => {
  it("names the transition on the root only while it runs", async () => {
    stubWindow(false);
    const dataset: Record<string, string> = {};
    let finish: (() => void) | undefined;
    const finished = new Promise<void>((resolve) => (finish = resolve));
    let updated: Promise<void> | undefined;
    let seenDuringUpdate: string | undefined;
    vi.stubGlobal("document", {
      documentElement: { dataset },
      querySelector: () => ({}),
      startViewTransition: (update: () => Promise<void>) => {
        updated = update();
        return { finished };
      },
    });

    const run = runArgusModeTransition("melt", "sanctuary", () => {
      seenDuringUpdate = dataset.argusModeTransition;
    });
    await updated;
    expect(seenDuringUpdate).toBe("melt");
    expect(dataset.argusModeTransition).toBe("melt");

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

    await runArgusModeTransition("split", "command", update);

    expect(update).toHaveBeenCalledOnce();
    expect(startViewTransition).not.toHaveBeenCalled();
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

    await runArgusModeTransition("split", "command", update);

    expect(update).toHaveBeenCalledOnce();
    expect(dataset.argusModeTransition).toBeUndefined();
  });
});
