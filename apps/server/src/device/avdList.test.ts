import type { DeviceSummary } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import { withStoppedAvds } from "./avdList.ts";

const runningPixel: DeviceSummary = {
  hostId: "local",
  id: "emulator-5554",
  name: "Pixel_9_API_36",
  platform: "android",
  version: "Android 16",
  booted: true,
  physical: false,
};

describe("withStoppedAvds", () => {
  it("adds stopped AVDs and skips ones the hub already lists as running", () => {
    const stdout = "Pixel_9_API_36\r\nMedium_Phone_API_35\n\n";
    expect(withStoppedAvds([runningPixel], "local", stdout)).toEqual([
      runningPixel,
      {
        hostId: "local",
        id: "Medium_Phone_API_35",
        name: "Medium_Phone_API_35",
        platform: "android",
        version: "Android",
        booted: false,
        physical: false,
      },
    ]);
  });

  it("ignores emulator diagnostics printed alongside AVD names", () => {
    const stdout = [
      "INFO    | Storing crashdata in: /tmp/android-bubba/emu-crash-35.db",
      "Tablet_API_35",
    ].join("\n");
    expect(withStoppedAvds([], "local", stdout).map((device) => device.name)).toEqual([
      "Tablet_API_35",
    ]);
  });

  it("adds nothing when no AVDs exist", () => {
    expect(withStoppedAvds([runningPixel], "local", "")).toEqual([runningPixel]);
  });
});
