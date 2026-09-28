import type { DevicePlatform } from "@t3tools/contracts";

export type DeviceBodyKind = "iphone" | "ipad" | "watch" | "android-phone" | "android-tablet";
export type DeviceBodyCutout = "island" | "notch" | "punch-hole" | "none";
export type DeviceOrientation =
  | "portrait"
  | "portrait_upside_down"
  | "landscape_left"
  | "landscape_right";

/**
 * A device body drawn in portrait, in units of the screen's short side. Bezels
 * are measured outward from the glass; `bodyRadius` is the outer corner.
 */
export interface DeviceBodySpec {
  readonly kind: DeviceBodyKind;
  /** Screen width / height in portrait before the first frame reports its size. */
  readonly defaultAspect: number;
  readonly bezel: { readonly side: number; readonly top: number; readonly bottom: number };
  readonly bodyRadius: number;
  readonly screenRadius: number;
  readonly cutout: DeviceBodyCutout;
  readonly homeButton: boolean;
  /** Hardware keys along the portrait left or right edge; `at` and `length` are fractions of the body height. */
  readonly keys: ReadonlyArray<{
    readonly edge: "left" | "right";
    readonly at: number;
    readonly length: number;
  }>;
}

const IPHONE_KEYS: DeviceBodySpec["keys"] = [
  { edge: "left", at: 0.16, length: 0.045 },
  { edge: "left", at: 0.24, length: 0.08 },
  { edge: "left", at: 0.34, length: 0.08 },
  { edge: "right", at: 0.26, length: 0.12 },
];
const ANDROID_KEYS: DeviceBodySpec["keys"] = [
  { edge: "right", at: 0.22, length: 0.08 },
  { edge: "right", at: 0.34, length: 0.16 },
];

/** Which iPhone generation's front the name implies: home button, notch, or Dynamic Island. */
function iphoneFront(name: string): "home" | "notch" | "island" {
  if (/\bSE\b|iPhone\s*[5-8]\b/i.test(name)) return "home";
  if (/iPhone\s*X|iPhone\s*1[0-3]\b|iPhone\s*1[46]e\b/i.test(name)) return "notch";
  if (/iPhone\s*14\b/i.test(name) && !/\bPro\b/i.test(name)) return "notch";
  return "island";
}

/**
 * The body for a simulator or emulator, chosen from its platform and name.
 * Returns null for devices that are not handheld (Apple TV, Vision Pro, Android TV),
 * which keep the bare screen.
 */
export function deviceBodyFor(
  platform: DevicePlatform,
  name: string | undefined,
): DeviceBodySpec | null {
  // AVD names separate words with underscores, which regex word boundaries treat as letters.
  const label = (name ?? "").replaceAll("_", " ");
  if (platform === "ios") {
    if (/Apple\s*TV|Vision/i.test(label)) return null;
    if (/Watch/i.test(label)) {
      return {
        kind: "watch",
        defaultAspect: 0.82,
        bezel: { side: 0.09, top: 0.09, bottom: 0.09 },
        bodyRadius: 0.32,
        screenRadius: 0.22,
        cutout: "none",
        homeButton: false,
        keys: [
          { edge: "right", at: 0.24, length: 0.16 },
          { edge: "right", at: 0.52, length: 0.2 },
        ],
      };
    }
    if (/iPad/i.test(label)) {
      return {
        kind: "ipad",
        defaultAspect: 0.72,
        bezel: { side: 0.05, top: 0.05, bottom: 0.05 },
        bodyRadius: 0.075,
        screenRadius: 0.025,
        cutout: "none",
        homeButton: false,
        keys: [{ edge: "right", at: 0.06, length: 0.07 }],
      };
    }
    const front = iphoneFront(label);
    if (front === "home") {
      return {
        kind: "iphone",
        defaultAspect: 9 / 16,
        bezel: { side: 0.07, top: 0.24, bottom: 0.24 },
        bodyRadius: 0.2,
        screenRadius: 0,
        cutout: "none",
        homeButton: true,
        keys: IPHONE_KEYS,
      };
    }
    return {
      kind: "iphone",
      defaultAspect: 9 / 19.5,
      bezel: { side: 0.045, top: 0.045, bottom: 0.045 },
      bodyRadius: 0.19,
      screenRadius: front === "island" ? 0.145 : 0.12,
      cutout: front,
      homeButton: false,
      keys: IPHONE_KEYS,
    };
  }
  if (/\bTV\b/i.test(label)) return null;
  if (/Tablet|\bTab\b|Pixel\s*C\b|Nexus\s*(7|9|10)\b|Fold/i.test(label)) {
    return {
      kind: "android-tablet",
      defaultAspect: 10 / 16,
      bezel: { side: 0.045, top: 0.045, bottom: 0.045 },
      bodyRadius: 0.07,
      screenRadius: 0.03,
      cutout: "none",
      homeButton: false,
      keys: ANDROID_KEYS,
    };
  }
  return {
    kind: "android-phone",
    defaultAspect: 9 / 20,
    bezel: { side: 0.03, top: 0.035, bottom: 0.035 },
    bodyRadius: 0.11,
    screenRadius: 0.08,
    cutout: "punch-hole",
    homeButton: false,
    keys: ANDROID_KEYS,
  };
}

export interface BodyRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface DeviceBodyLayout {
  readonly turns: number;
  readonly width: number;
  readonly height: number;
  readonly radius: number;
  readonly screen: BodyRect & { readonly radius: number };
  readonly cutout: (BodyRect & { readonly kind: DeviceBodyCutout }) | null;
  readonly homeButton: BodyRect | null;
  readonly keys: ReadonlyArray<BodyRect>;
}

/**
 * Clockwise quarter turns from portrait, matching how the stream rotates a
 * landscape frame. A landscape screen always turns the body sideways, even when
 * the device reports no orientation.
 */
function bodyTurns(orientation: DeviceOrientation | undefined, screenAspect: number | null) {
  const turns =
    orientation === "landscape_left"
      ? 1
      : orientation === "portrait_upside_down"
        ? 2
        : orientation === "landscape_right"
          ? 3
          : 0;
  if (screenAspect === null || screenAspect > 1 === (turns % 2 === 1)) return turns;
  return screenAspect > 1 ? 1 : 0;
}

function rotateCw(rect: BodyRect, bodyHeight: number): BodyRect {
  return {
    left: bodyHeight - rect.top - rect.height,
    top: rect.left,
    width: rect.height,
    height: rect.width,
  };
}

/**
 * The largest body that fits `box`, keeping the device's proportions. The
 * screen keeps the stream's aspect; every other part scales with it, and the
 * body turns with the device so the island or camera follows the top edge.
 */
export function layoutDeviceBody(input: {
  readonly box: { readonly width: number; readonly height: number };
  readonly spec: DeviceBodySpec;
  /** Screen width / height as displayed, or null before the first frame. */
  readonly screenAspect: number | null;
  readonly orientation?: DeviceOrientation | undefined;
}): DeviceBodyLayout | null {
  const { box, spec } = input;
  if (box.width <= 0 || box.height <= 0) return null;
  const aspect = input.screenAspect ?? spec.defaultAspect;
  const portrait = Math.min(aspect, 1 / aspect);
  const screenH = 1 / portrait;
  const { side, top, bottom } = spec.bezel;
  const bodyW = 1 + side * 2;
  const bodyH = screenH + top + bottom;

  const screen: BodyRect = { left: side, top, width: 1, height: screenH };
  let cutout: BodyRect | null = null;
  if (spec.cutout === "island") {
    cutout = { left: side + 0.34, top: top + 0.03, width: 0.32, height: 0.094 };
  } else if (spec.cutout === "notch") {
    cutout = { left: side + 0.235, top, width: 0.53, height: 0.08 };
  } else if (spec.cutout === "punch-hole") {
    cutout = { left: side + 0.4725, top: top + 0.03, width: 0.055, height: 0.055 };
  }
  const homeButton: BodyRect | null = spec.homeButton
    ? {
        left: bodyW / 2 - 0.085,
        top: top + screenH + bottom / 2 - 0.085,
        width: 0.17,
        height: 0.17,
      }
    : null;
  const keyDepth = 0.022;
  const keys = spec.keys.map((key): BodyRect => ({
    left: key.edge === "left" ? -keyDepth : bodyW,
    top: key.at * bodyH,
    width: keyDepth,
    height: key.length * bodyH,
  }));

  const turns = bodyTurns(input.orientation, input.screenAspect);
  let rects = { screen, cutout, homeButton, keys };
  let w = bodyW;
  let h = bodyH;
  for (let i = 0; i < turns; i++) {
    const height = h;
    rects = {
      screen: rotateCw(rects.screen, height),
      cutout: rects.cutout ? rotateCw(rects.cutout, height) : null,
      homeButton: rects.homeButton ? rotateCw(rects.homeButton, height) : null,
      keys: rects.keys.map((key) => rotateCw(key, height)),
    };
    [w, h] = [h, w];
  }

  const scale = Math.min(box.width / w, box.height / h);
  const px = (rect: BodyRect): BodyRect => ({
    left: rect.left * scale,
    top: rect.top * scale,
    width: rect.width * scale,
    height: rect.height * scale,
  });
  return {
    turns,
    width: w * scale,
    height: h * scale,
    radius: spec.bodyRadius * scale,
    screen: { ...px(rects.screen), radius: spec.screenRadius * scale },
    cutout: rects.cutout ? { ...px(rects.cutout), kind: spec.cutout } : null,
    homeButton: rects.homeButton ? px(rects.homeButton) : null,
    keys: rects.keys.map(px),
  };
}
