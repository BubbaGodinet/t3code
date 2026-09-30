/**
 * The Command → Sanctuary melt. A snapshot of Command dissolves into Sanctuary
 * through demo 5 of Codrops' WebGL Image Transitions by Yuri Artiukh
 * (https://github.com/akella/webGLImageTransitions, `js/demo5.js`): each image
 * is pushed down by the other's brightness while the two cross-fade.
 */

import { animateArgusShader, createArgusShaderOverlay, nextFrame } from "./argusWindowShader";

/** demo5.js `intensity`. */
const MELT_INTENSITY = 0.3;
/** Sketch's default duration: one second. */
const MELT_DURATION_MS = 1000;
/** The finished image fades onto live Sanctuary, whose text the image lacks. */
const MELT_REVEAL_MS = 220;

/** demo5.js's fragment shader. Both images match the canvas, so its aspect fit is dropped. */
const MELT_FRAGMENT_SHADER = `
precision highp float;

uniform float progress;
uniform float intensity;
uniform sampler2D texture1;
uniform sampler2D texture2;
varying vec2 vUv;

void main() {
  vec4 d1 = texture2D(texture1, vUv);
  vec4 d2 = texture2D(texture2, vUv);

  float displace1 = (d1.r + d1.g + d1.b) * 0.33;
  float displace2 = (d2.r + d2.g + d2.b) * 0.33;

  vec4 t1 = texture2D(texture1, vec2(vUv.x, vUv.y + progress * (displace2 * intensity)));
  vec4 t2 = texture2D(texture2, vec2(vUv.x, vUv.y + (1.0 - progress) * (displace1 * intensity)));

  gl_FragColor = mix(t1, t2, progress);
}
`;

/** GSAP's Power2.easeInOut, the sketch's default easing. */
export function meltEase(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
}

type SanctuarySnapshot = (width: number, height: number) => HTMLCanvasElement | null;
let sanctuarySnapshot: SanctuarySnapshot | null = null;

/** Sanctuary registers how to paint itself at a pixel size; the melt melts into that. */
export function provideSanctuarySnapshot(snapshot: SanctuarySnapshot): () => void {
  sanctuarySnapshot = snapshot;
  return () => {
    if (sanctuarySnapshot === snapshot) sanctuarySnapshot = null;
  };
}

function paintSanctuary(width: number, height: number): HTMLCanvasElement {
  const painted = sanctuarySnapshot?.(width, height);
  if (painted) return painted;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = "#3e356e";
    context.fillRect(0, 0, width, height);
  }
  return canvas;
}

/**
 * Covers the window (under the pill) with the Command snapshot, runs `update`
 * beneath it, waits for `committed`, then melts into a painting of Sanctuary and
 * fades onto the live page. False, without running `update`, when WebGL is
 * unavailable so the caller can fall back.
 */
export async function playArgusMelt(
  command: HTMLCanvasElement,
  update: () => Promise<void>,
  committed: () => Promise<void>,
): Promise<boolean> {
  const overlay = createArgusShaderOverlay({
    width: command.width,
    height: command.height,
    fragmentShader: MELT_FRAGMENT_SHADER,
    progressUniform: "progress",
    alpha: false,
  });
  if (!overlay) return false;
  const { gl, program, canvas } = overlay;
  gl.uniform1f(gl.getUniformLocation(program, "intensity"), MELT_INTENSITY);
  gl.uniform1i(gl.getUniformLocation(program, "texture1"), 0);
  gl.uniform1i(gl.getUniformLocation(program, "texture2"), 1);
  canvas.style.transition = `opacity ${MELT_REVEAL_MS}ms ease-out`;
  overlay.upload(0, command);
  overlay.upload(1, command);
  overlay.draw(0);
  overlay.mount();

  try {
    await update();
    await committed();
    // Two frames: the space's effects (the silk canvas) run after its first paint.
    await nextFrame();
    await nextFrame();
    overlay.upload(1, paintSanctuary(canvas.width, canvas.height));
    await animateArgusShader(MELT_DURATION_MS, (t) => overlay.draw(meltEase(t)));

    canvas.style.opacity = "0";
    await new Promise((resolve) => window.setTimeout(resolve, MELT_REVEAL_MS));
  } finally {
    overlay.dispose();
  }
  return true;
}
