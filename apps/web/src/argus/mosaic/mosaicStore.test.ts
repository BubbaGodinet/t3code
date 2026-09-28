import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { ThreadRouteTarget } from "../../threadRoutes";
import { placeRouteTarget, type MosaicPane } from "./mosaicStore";
import { buildPresetTree, collectPaneIds } from "./mosaicTree";

const environmentId = EnvironmentId.make("env");
const thread = (id: string): ThreadRouteTarget => ({
  kind: "server",
  threadRef: scopeThreadRef(environmentId, ThreadId.make(id)),
});
const chat = (id: string, target: ThreadRouteTarget | null): MosaicPane => ({
  id,
  kind: "chat",
  companyId: null,
  target,
});
const terminal = (id: string): MosaicPane => ({
  id,
  kind: "terminal",
  companyId: null,
  sessionThreadId: `argus-terminal-${id}`,
  terminalId: "default",
});

function snapshot(panes: MosaicPane[], activePaneId: string | null) {
  let splitCount = 0;
  return {
    panes: Object.fromEntries(panes.map((pane) => [pane.id, pane])),
    root: buildPresetTree(
      "three-over-two",
      panes.map((pane) => pane.id),
      () => `split-${splitCount++}`,
    ),
    activePaneId,
  };
}

describe("placeRouteTarget", () => {
  it("focuses the pane already showing the route thread", () => {
    const state = snapshot([chat("a", thread("one")), chat("b", thread("two"))], "a");
    expect(placeRouteTarget(state, thread("two"), "navigate").activePaneId).toBe("b");
  });

  it("replaces the active chat pane on navigation", () => {
    const state = snapshot([chat("a", thread("one")), chat("b", thread("two"))], "a");
    const next = placeRouteTarget(state, thread("three"), "navigate");
    expect(next.panes.a).toMatchObject({ target: thread("three") });
    expect(next.panes.b).toMatchObject({ target: thread("two") });
  });

  it("does not replace a filled pane when entering the grid", () => {
    const state = snapshot([chat("a", thread("one"))], "a");
    expect(placeRouteTarget(state, thread("two"), "enter")).toBe(state);
  });

  it("fills an empty chat pane when a terminal is active", () => {
    const state = snapshot([terminal("t"), chat("a", null)], "t");
    const next = placeRouteTarget(state, thread("one"), "navigate");
    expect(next.activePaneId).toBe("a");
    expect(next.panes.a).toMatchObject({ target: thread("one") });
  });

  it("opens a new pane beside a terminal when no chat pane can take the thread", () => {
    const state = snapshot([terminal("t")], "t");
    const next = placeRouteTarget(state, thread("one"), "navigate");
    expect(collectPaneIds(next.root)).toHaveLength(2);
    expect(next.panes[next.activePaneId!]).toMatchObject({ kind: "chat", target: thread("one") });
  });

  it("seeds an empty grid with the route thread", () => {
    const next = placeRouteTarget(
      { panes: {}, root: null, activePaneId: null },
      thread("one"),
      "enter",
    );
    expect(collectPaneIds(next.root)).toEqual([next.activePaneId]);
  });
});
