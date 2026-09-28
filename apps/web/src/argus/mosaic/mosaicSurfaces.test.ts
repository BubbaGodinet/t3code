import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId, type PreviewSessionSnapshot } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { MosaicPane } from "./mosaicStore";
import {
  detachedFloatingPaneIds,
  dockFloatingPane,
  findSourcePaneId,
  findSurfacePaneId,
  groupDevicesForPicker,
  normalizeTypedUrl,
  placeSurfacePane,
  resolveSessionBrowserUrl,
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
      inChatBrowserSupported: false,
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
      inChatBrowserSupported: true,
    });
    expect(fromTerminal[0]?.disabledReason).toMatch(/started chat/);
    expect(fromTerminal.slice(1).every((option) => option.disabledReason === null)).toBe(true);

    const webBrowser = surfacePlacementOptions({
      kind: "browser",
      source: threadSource,
      inChatBrowserSupported: false,
    });
    expect(webBrowser[0]?.disabledReason).toMatch(/desktop app/);
    expect(
      surfacePlacementOptions({
        kind: "browser",
        source: threadSource,
        inChatBrowserSupported: true,
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

const previewSnapshot = (navStatus: PreviewSessionSnapshot["navStatus"]) =>
  ({ navStatus }) as PreviewSessionSnapshot;

describe("session browser URL", () => {
  const servers = [
    { url: "http://localhost:5173/", port: 5173 },
    { url: "http://localhost:3000/", port: 3000 },
  ];

  it("prefers a pinned URL, then the chat's preview page, then the lowest dev server port", () => {
    const preview = previewSnapshot({
      _tag: "Success",
      url: "http://localhost:5173/settings",
      title: "Settings",
    } as PreviewSessionSnapshot["navStatus"]);
    expect(
      resolveSessionBrowserUrl({
        pinnedUrl: "http://localhost:8080/",
        activePreview: preview,
        sessionServers: servers,
      }),
    ).toEqual({ url: "http://localhost:8080/", source: "pinned" });
    expect(
      resolveSessionBrowserUrl({
        pinnedUrl: null,
        activePreview: preview,
        sessionServers: servers,
      }),
    ).toEqual({ url: "http://localhost:5173/settings", source: "preview" });
    expect(
      resolveSessionBrowserUrl({
        pinnedUrl: null,
        activePreview: previewSnapshot({ _tag: "Idle" }),
        sessionServers: servers,
      }),
    ).toEqual({ url: "http://localhost:3000/", source: "server" });
    expect(
      resolveSessionBrowserUrl({ pinnedUrl: null, activePreview: null, sessionServers: [] }),
    ).toEqual({ url: null, source: "none" });
  });

  it("reads what a user types in the address bar", () => {
    expect(normalizeTypedUrl("3000")).toBe("http://localhost:3000/");
    expect(normalizeTypedUrl("localhost:5173/app")).toBe("http://localhost:5173/app");
    expect(normalizeTypedUrl("https://example.com")).toBe("https://example.com/");
    expect(normalizeTypedUrl("  ")).toBeNull();
    expect(normalizeTypedUrl("file:///etc/hosts")).toBeNull();
  });
});

describe("device picker list", () => {
  it("groups iOS before Android with running devices first", () => {
    const groups = groupDevicesForPicker([
      { platform: "android", name: "Pixel_9", version: "Android", booted: false },
      { platform: "ios", name: "iPhone 17", version: "iOS 26.5", booted: false },
      { platform: "ios", name: "iPhone 18 Pro", version: "iOS 27.0", booted: true },
      { platform: "ios", name: "iPhone 17", version: "iOS 27.0", booted: false },
    ]);
    expect(groups.map((group) => group.platform)).toEqual(["ios", "android"]);
    expect(groups[0]!.devices.map((device) => `${device.name} ${device.version}`)).toEqual([
      "iPhone 18 Pro iOS 27.0",
      "iPhone 17 iOS 27.0",
      "iPhone 17 iOS 26.5",
    ]);
    expect(groupDevicesForPicker([])).toEqual([]);
  });
});
