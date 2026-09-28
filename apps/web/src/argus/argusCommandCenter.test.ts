import { describe, expect, it } from "vite-plus/test";

import { argusModeTabs, DEFAULT_ARGUS_ORIGIN, normalizeArgusOrigin } from "./argusCommandCenter";

describe("Argus mode switcher", () => {
  it("shows Command and Sanctuary whether or not a parent frame is detected", () => {
    for (const inFrame of [true, false]) {
      const tabs = argusModeTabs({ inFrame, argusOrigin: DEFAULT_ARGUS_ORIGIN });
      expect(tabs.map((tab) => tab.label)).toEqual(["Command", "Sanctuary"]);
      expect(tabs.find((tab) => tab.selected)?.mode).toBe("command");
    }
  });

  it("routes Sanctuary through the framing Argus window", () => {
    const sanctuary = argusModeTabs({ inFrame: true, argusOrigin: "http://localhost:3100" })[1]!;
    expect(sanctuary.action).toEqual({
      kind: "frame",
      mode: "sanctuary",
      url: "http://localhost:3100/sanctuary",
    });
  });

  it("opens Argus Sanctuary when nothing frames the grid", () => {
    const sanctuary = argusModeTabs({ inFrame: false, argusOrigin: DEFAULT_ARGUS_ORIGIN })[1]!;
    expect(sanctuary.action).toEqual({ kind: "open", url: "http://localhost:3100/sanctuary" });
  });

  it("keeps Command on the grid", () => {
    const command = argusModeTabs({ inFrame: true, argusOrigin: DEFAULT_ARGUS_ORIGIN })[0]!;
    expect(command.action).toEqual({ kind: "grid" });
  });

  it("accepts only http(s) Argus origins from the frame URL", () => {
    expect(normalizeArgusOrigin("http://127.0.0.1:3100/some/path")).toBe("http://127.0.0.1:3100");
    expect(normalizeArgusOrigin("javascript:alert(1)")).toBeNull();
    expect(normalizeArgusOrigin("not a url")).toBeNull();
    expect(normalizeArgusOrigin(null)).toBeNull();
  });
});
