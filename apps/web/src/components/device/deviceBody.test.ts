import { describe, expect, it } from "vite-plus/test";

import { deviceBodyFor, layoutDeviceBody } from "./deviceBody";

describe("deviceBodyFor", () => {
  it("puts iOS simulators in the body their name implies", () => {
    expect(deviceBodyFor("ios", "iPhone 16 Pro")).toMatchObject({
      kind: "iphone",
      cutout: "island",
    });
    expect(deviceBodyFor("ios", "iPhone 14 Pro Max")?.cutout).toBe("island");
    expect(deviceBodyFor("ios", "iPhone 14 Plus")?.cutout).toBe("notch");
    expect(deviceBodyFor("ios", "iPhone 13 mini")?.cutout).toBe("notch");
    expect(deviceBodyFor("ios", "iPhone SE (3rd generation)")).toMatchObject({
      kind: "iphone",
      homeButton: true,
    });
    expect(deviceBodyFor("ios", "iPad Pro 13-inch (M4)")?.kind).toBe("ipad");
    expect(deviceBodyFor("ios", "Apple Watch Series 10 (46mm)")?.kind).toBe("watch");
    expect(deviceBodyFor("ios", "Apple TV 4K (3rd generation)")).toBeNull();
  });

  it("puts Android AVDs in an Android body without an Apple island", () => {
    expect(deviceBodyFor("android", "Pixel_8_API_35")).toMatchObject({
      kind: "android-phone",
      cutout: "punch-hole",
    });
    expect(deviceBodyFor("android", "iPhone-looking AVD")?.kind).toBe("android-phone");
    expect(deviceBodyFor("android", "Pixel_Tablet_API_34")?.kind).toBe("android-tablet");
    expect(deviceBodyFor("android", "Nexus_10_API_30")?.kind).toBe("android-tablet");
    expect(deviceBodyFor("android", "Galaxy_Tab_S8")?.kind).toBe("android-tablet");
    expect(deviceBodyFor("android", "Android_TV_1080p_API_34")).toBeNull();
  });
});

describe("layoutDeviceBody", () => {
  const spec = deviceBodyFor("ios", "iPhone 16")!;

  it("scales with the box and keeps the phone's proportions", () => {
    const small = layoutDeviceBody({ box: { width: 200, height: 400 }, spec, screenAspect: null })!;
    const large = layoutDeviceBody({ box: { width: 400, height: 800 }, spec, screenAspect: null })!;
    expect(large.width).toBeCloseTo(small.width * 2);
    expect(large.height / large.width).toBeCloseTo(small.height / small.width);
    expect(small.height).toBeLessThanOrEqual(400);
    expect(small.width).toBeLessThanOrEqual(200);
    expect(small.screen.width / small.screen.height).toBeCloseTo(9 / 19.5);
  });

  it("turns the body sideways with a landscape screen", () => {
    const layout = layoutDeviceBody({
      box: { width: 800, height: 400 },
      spec,
      screenAspect: 19.5 / 9,
      orientation: "landscape_left",
    })!;
    expect(layout.width).toBeGreaterThan(layout.height);
    expect(layout.screen.width / layout.screen.height).toBeCloseTo(19.5 / 9);
    // The island follows the device's top edge, which the stream turns to the right.
    expect(layout.cutout!.left).toBeGreaterThan(layout.width / 2);
    expect(layout.cutout!.height).toBeGreaterThan(layout.cutout!.width);
  });
});
