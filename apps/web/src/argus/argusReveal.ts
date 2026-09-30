/**
 * The Command ↔ Sanctuary reveal, the same both ways. A snapshot of the space
 * being left is eaten away by the shader from Arlind Aliu's Shader Image
 * Transition (https://github.com/Arrlindii/Shader-Image-Transition,
 * `src/shaders/fragment.glsl`, MIT): a noisy circle grows from the center and
 * merges with rings of smaller circles, and the live space being entered shows
 * through wherever it has reached.
 */

import { animateArgusShader, createArgusShaderOverlay, nextFrame } from "./argusWindowShader";

/** The demo tweens over three seconds; a mode switch cannot wait that long. */
const REVEAL_DURATION_MS = 1200;

/**
 * fragment.glsl, for WebGL 1: `round` is written out, and instead of revealing
 * the texture over transparency it keeps the outgoing space where the shape
 * has not reached and clears it where it has.
 */
const REVEAL_FRAGMENT_SHADER = `
precision highp float;

varying vec2 vUv;
uniform float uProgress;
uniform vec2 uSize;
uniform sampler2D uTexture;
#define PI 3.1415926538

float noise(vec2 point) {
  float frequency = 1.0;
  float angle = atan(point.y, point.x) + uProgress * PI;

  float w0 = (cos(angle * frequency) + 1.0) / 2.0;
  float w1 = (sin(2. * angle * frequency) + 1.0) / 2.0;
  float w2 = (cos(3. * angle * frequency) + 1.0) / 2.0;
  float wave = (w0 + w1 + w2) / 3.0;
  return wave;
}

float softMax(float a, float b, float k) {
  return log(exp(k * a) + exp(k * b)) / k;
}

float softMin(float a, float b, float k) {
  return -softMax(-a, -b, k);
}

float circleSDF(vec2 pos, float rad) {
  float a = sin(uProgress * 0.2) * 0.25;
  float amt = 0.5 + a;
  float circle = length(pos);
  circle += noise(pos) * rad * amt;
  return circle;
}

float radialCircles(vec2 p, float o, float count) {
  vec2 offset = vec2(o, o);

  float angle = (2. * PI) / count;
  float s = floor(atan(p.y, p.x) / angle + 0.5);
  float an = angle * s;
  vec2 q = vec2(offset.x * cos(an), offset.y * sin(an));
  vec2 pos = p - q;
  float circle = circleSDF(pos, 15.0);
  return circle;
}

void main() {
  vec4 image = texture2D(uTexture, vUv);
  vec2 coords = vUv * uSize;
  vec2 o1 = vec2(0.5) * uSize;

  float t = pow(uProgress, 2.5);
  float radius = uSize.x / 2.0;
  float rad = t * radius;
  float c1 = circleSDF(coords - o1, rad);

  vec2 p = (vUv - 0.5) * uSize;
  float r1 = radialCircles(p, 0.2 * uSize.x, 3.0);
  float r2 = radialCircles(p, 0.25 * uSize.x, 3.0);
  float r3 = radialCircles(p, 0.45 * uSize.x, 5.0);

  float k = 50.0 / uSize.x;
  float circle = softMin(c1, r1, k);
  circle = softMin(circle, r2, k);
  circle = softMin(circle, r3, k);

  circle = step(circle, rad);
  gl_FragColor = image * (1.0 - circle);
}
`;

/** GSAP's default ease, power1.out, which the demo's progress tween uses. */
export function revealEase(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

/**
 * Covers the window (under the pill) with the `outgoing` snapshot, runs
 * `update` beneath it, waits for `committed`, then reveals the live new space
 * through the shape. False, without running `update`, when WebGL is unavailable
 * so the caller can fall back.
 */
export async function playArgusReveal(
  outgoing: HTMLCanvasElement,
  update: () => Promise<void>,
  committed: () => Promise<void>,
): Promise<boolean> {
  const overlay = createArgusShaderOverlay({
    width: outgoing.width,
    height: outgoing.height,
    fragmentShader: REVEAL_FRAGMENT_SHADER,
    progressUniform: "uProgress",
    alpha: true,
  });
  if (!overlay) return false;
  const { gl, program } = overlay;
  // The demo's sizes are in CSS pixels, which its constants are tuned for.
  gl.uniform2f(gl.getUniformLocation(program, "uSize"), window.innerWidth, window.innerHeight);
  gl.uniform1i(gl.getUniformLocation(program, "uTexture"), 0);
  overlay.upload(0, outgoing);
  overlay.draw(0);
  overlay.mount();

  try {
    await update();
    await committed();
    // Two frames: the new space's effects (Sanctuary's silk canvas) run after its first paint.
    await nextFrame();
    await nextFrame();
    await animateArgusShader(REVEAL_DURATION_MS, (t) => overlay.draw(revealEase(t)));
  } finally {
    overlay.dispose();
  }
  return true;
}
