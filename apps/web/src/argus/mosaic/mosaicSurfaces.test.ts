import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { MosaicPane } from "./mosaicStore";
import {
  detachedFloatingPaneIds,
  dockFloatingPane,
  findSourcePaneId,
  findSurfacePaneId,
  placeSurfacePane,
  sessionBrowserStartUrl,
  surfacePlacementOptions,
  type MosaicSurfaceSource,
} from "./mosaicSurfaces";
import { buildPresetTree, collectPaneIds } from "./mosaicTree";

const environmentId = EnvironmentId.make("env");
const threadRef = scopeThreadRef(environmentId, ThreadId.make("t1"));
const threadSource: MosaicSurfaceSource = { kind: "thread", threadRef };
const terminalSource: MosaicSurfaceSource = {
  kind: "terminal",
  threadRef: scopeThreadRef(environmentId, ThreadId.make("argus-terminal-term")),
};

function grid() {
  let splits = 0;
  const panes: MosaicPane[] = [
    { id: "chat", kind: "chat", companyId: "acme", target: { kind: "server", threadRef } },
    {
      id: "term",
      kind: "terminal",
      companyId: "acme",
      sessionThreadId: "argus-terminal-term",
      terminalId: "default",
    },
  ];
  return {
    panes: Object.fromEntries(panes.map((pane) => [pane.id, pane])),
    root: buildPresetTree(
      "row",
      panes.map((pane) => pane.id),
      () => `split-${splits++}`,
    ),
    floating: {},
    activePaneId: "chat",
  };
}

const browser: MosaicPane = {
  id: "browser",
  kind: "browser",
  companyId: "acme",
  source: threadSource,
  url: null,
};
const newId = () => "split-new";

describe("surface placement options", () => {
  it("offers all three placements for a started chat's emulator", () => {
    const options = surfacePlacementOptions({
      kind: "device",
      source: threadSource,
      browserSupported: false,
    });
    expect(options.map((option) => [option.placement, option.disabledReason])).toEqual([
      ["chat", null],
      ["float", null],
      ["pane", null],
    ]);
  });

  it("explains why the chat placement is unavailable, keeping float and pane", () => {
    const fromTerminal = surfacePlacementOptions({
      kind: "device",
      source: terminalSource,
      browserSupported: true,
    });
    expect(fromTerminal[0]?.disabledReason).toMatch(/started chat/);
    expect(fromTerminal.slice(1).every((option) => option.disabledReason === null)).toBe(true);
  });

  it("offers T3's browser in no placement where it cannot run", () => {
    const webBrowser = surfacePlacementOptions({
      kind: "browser",
      source: threadSource,
      browserSupported: false,
    });
    expect(webBrowser.every((option) => /desktop app/.test(option.disabledReason ?? ""))).toBe(
      true,
    );
    expect(
      surfacePlacementOptions({
        kind: "browser",
        source: threadSource,
        browserSupported: true,
      })[0]?.disabledReason,
    ).toBeNull();
  });
});

describe("placing a surface pane", () => {
  it("puts an own-pane surface in the grid beside the pane it came from", () => {
    const next = placeSurfacePane(grid(), browser, "pane", { paneId: "chat", slot: null }, newId);
    expect(collectPaneIds(next.root)).toEqual(["chat", "browser", "term"]);
    expect(next.floating).toEqual({});
    expect(next.activePaneId).toBe("browser");
  });

  it("floats a surface over the grid without taking a grid slot", () => {
    const slot = { x: 0, y: 0, width: 50, height: 100 };
    const next = placeSurfacePane(grid(), browser, "float", { paneId: "chat", slot }, newId);
    expect(collectPaneIds(next.root)).toEqual(["chat", "term"]);
    expect(next.floating.browser).toBeDefined();
    expect(next.floating.browser!.x).toBeLessThan(50);
    expect(detachedFloatingPaneIds(next)).toEqual(["browser"]);
  });

  it("docks a floating surface into the grid beside its session's chat", () => {
    const floated = placeSurfacePane(
      grid(),
      browser,
      "float",
      { paneId: "chat", slot: null },
      newId,
    );
    const docked = dockFloatingPane(
      floated,
      "browser",
      findSourcePaneId(floated, threadSource),
      newId,
    );
    expect(collectPaneIds(docked.root)).toEqual(["chat", "browser", "term"]);
    expect(docked.floating).toEqual({});
    expect(detachedFloatingPaneIds(docked)).toEqual([]);
  });

  it("returns a popped-out grid pane to its own slot", () => {
    const popped = { ...grid(), floating: { term: { x: 10, y: 10, width: 40, height: 40 } } };
    const docked = dockFloatingPane(popped, "term", "chat", newId);
    expect(docked.root).toBe(popped.root);
    expect(docked.floating).toEqual({});
  });

  it("finds the grid pane showing a session's chat or terminal", () => {
    expect(findSourcePaneId(grid(), threadSource)).toBe("chat");
    expect(findSourcePaneId(grid(), terminalSource)).toBe("term");
    expect(findSourcePaneId(grid(), null)).toBeNull();
  });

  it("finds a session's open browser whether it floats or sits in the grid", () => {
    const floated = placeSurfacePane(
      grid(),
      browser,
      "float",
      { paneId: "chat", slot: null },
      newId,
    );
    expect(findSurfacePaneId(floated, "browser", threadSource)).toBe("browser");
    expect(findSurfacePaneId(floated, "device", threadSource)).toBeNull();
    expect(findSurfacePaneId(floated, "browser", terminalSource)).toBeNull();
    expect(findSurfacePaneId(floated, "browser", null)).toBeNull();
    const other = scopeThreadRef(environmentId, ThreadId.make("t2"));
    expect(findSurfacePaneId(floated, "browser", { kind: "thread", threadRef: other })).toBeNull();
  });
});

describe("session browser start page", () => {
  it("prefers a saved URL, then the lowest dev server port", () => {
    const servers = [
      { url: "http://localhost:5173/", port: 5173 },
      { url: "http://localhost:3000/", port: 3000 },
    ];
    expect(
      sessionBrowserStartUrl({ pinnedUrl: "http://localhost:8080/", sessionServers: servers }),
    ).toBe("http://localhost:8080/");
    expect(sessionBrowserStartUrl({ pinnedUrl: null, sessionServers: servers })).toBe(
      "http://localhost:3000/",
    );
    expect(sessionBrowserStartUrl({ pinnedUrl: null, sessionServers: [] })).toBeNull();
  });
});
