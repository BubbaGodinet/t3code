import { describe, expect, it } from "vite-plus/test";

import {
  ARGUS_SANCTUARY_PATH,
  argusModeTabs,
  DEFAULT_ARGUS_ORIGIN,
  normalizeArgusOrigin,
} from "./argusCommandCenter";

describe("Argus mode switcher", () => {
  it("shows Command and Sanctuary whether or not a parent frame is detected", () => {
    for (const inFrame of [true, false]) {
      const tabs = argusModeTabs({
        inFrame,
        argusOrigin: DEFAULT_ARGUS_ORIGIN,
        current: "command",
      });
      expect(tabs.map((tab) => tab.label)).toEqual(["Command", "Sanctuary"]);
    }
  });

  it("selects the tab for the mode on screen", () => {
    for (const current of ["command", "sanctuary"] as const) {
      const tabs = argusModeTabs({ inFrame: false, argusOrigin: DEFAULT_ARGUS_ORIGIN, current });
      expect(tabs.filter((tab) => tab.selected).map((tab) => tab.mode)).toEqual([current]);
    }
  });

  it("routes Sanctuary through the framing Argus window", () => {
    const sanctuary = argusModeTabs({
      inFrame: true,
      argusOrigin: "http://localhost:3100",
      current: "command",
    })[1]!;
    expect(sanctuary.action).toEqual({
      kind: "frame",
      mode: "sanctuary",
      url: "http://localhost:3100/sanctuary",
    });
  });

  it("keeps Sanctuary in the app window when nothing frames it (desktop)", () => {
    const sanctuary = argusModeTabs({
      inFrame: false,
      argusOrigin: DEFAULT_ARGUS_ORIGIN,
      current: "command",
    })[1]!;
    expect(sanctuary.action).toEqual({ kind: "route", path: ARGUS_SANCTUARY_PATH });
    expect(ARGUS_SANCTUARY_PATH).toBe("/sanctuary");
  });

  it("keeps Command on the grid", () => {
    for (const current of ["command", "sanctuary"] as const) {
      const command = argusModeTabs({
        inFrame: true,
        argusOrigin: DEFAULT_ARGUS_ORIGIN,
        current,
      })[0]!;
      expect(command.action).toEqual({ kind: "grid" });
    }
  });

  it("accepts only http(s) Argus origins from the frame URL", () => {
    expect(normalizeArgusOrigin("http://127.0.0.1:3100/some/path")).toBe("http://127.0.0.1:3100");
    expect(normalizeArgusOrigin("javascript:alert(1)")).toBeNull();
    expect(normalizeArgusOrigin("not a url")).toBeNull();
    expect(normalizeArgusOrigin(null)).toBeNull();
  });
});
