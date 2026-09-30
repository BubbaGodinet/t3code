/**
 * The Command → Sanctuary melt. A snapshot of Command dissolves into Sanctuary
 * through demo 5 of Codrops' WebGL Image Transitions by Yuri Artiukh
 * (https://github.com/akella/webGLImageTransitions, `js/demo5.js`): each image
 * is pushed down by the other's brightness while the two cross-fade. The canvas
 * sits just under the mode pill, so the pill stays live and undistorted on top.
 */

/** demo5.js `intensity`. */
const MELT_INTENSITY = 0.3;
/** Sketch's default duration: one second. */
const MELT_DURATION_MS = 1000;
/** The finished image fades onto live Sanctuary, whose text the image lacks. */
const MELT_REVEAL_MS = 220;
/** Room around the pill left out of the snapshot, for its border and shadow. */
const PILL_MARGIN_PX = 4;

const MELT_VERTEX_SHADER = `
attribute vec2 aPosition;
varying vec2 vUv;

void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

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
 * Snapshots Command through the desktop bridge, with the pill's area filled from
 * the row beneath it so the distortion never smears a copy of the pill. Null on
 * the web, where the page cannot be captured.
 */
export async function captureArgusCommand(): Promise<HTMLCanvasElement | null> {
  try {
    const bytes = await window.sanctuaryDesktop?.captureWindow?.();
    if (!bytes?.length) return null;
    const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/jpeg" }));
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(bitmap, 0, 0);
    bitmap.close();

    const pill = document.querySelector(".argus-mode-pill")?.getBoundingClientRect();
    if (pill) {
      const scale = canvas.width / window.innerWidth;
      const x = Math.max(0, Math.floor((pill.left - PILL_MARGIN_PX) * scale));
      const y = Math.max(0, Math.floor((pill.top - PILL_MARGIN_PX) * scale));
      const width = Math.ceil((pill.width + PILL_MARGIN_PX * 2) * scale);
      const height = Math.ceil((pill.height + PILL_MARGIN_PX * 2) * scale);
      const below = Math.min(canvas.height - 1, y + height);
      context.drawImage(canvas, x, below, width, 1, x, y, width, height);
    }
    return canvas;
  } catch {
    return null;
  }
}

function compileMeltProgram(gl: WebGLRenderingContext) {
  const shader = (type: number, source: string) => {
    const created = gl.createShader(type);
    if (!created) return null;
    gl.shaderSource(created, source);
    gl.compileShader(created);
    return created;
  };
  const vertex = shader(gl.VERTEX_SHADER, MELT_VERTEX_SHADER);
  const fragment = shader(gl.FRAGMENT_SHADER, MELT_FRAGMENT_SHADER);
  const program = gl.createProgram();
  if (!vertex || !fragment || !program) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;

  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, "aPosition");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  gl.uniform1f(gl.getUniformLocation(program, "intensity"), MELT_INTENSITY);
  gl.uniform1i(gl.getUniformLocation(program, "texture1"), 0);
  gl.uniform1i(gl.getUniformLocation(program, "texture2"), 1);
  return { progress: gl.getUniformLocation(program, "progress") };
}

function uploadTexture(gl: WebGLRenderingContext, unit: number, source: HTMLCanvasElement) {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

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
  const canvas = document.createElement("canvas");
  canvas.width = command.width;
  canvas.height = command.height;
  canvas.setAttribute("aria-hidden", "true");
  Object.assign(canvas.style, {
    position: "fixed",
    inset: "0",
    width: "100%",
    height: "100%",
    zIndex: "39",
    pointerEvents: "none",
    transition: `opacity ${MELT_REVEAL_MS}ms ease-out`,
  });
  const gl = canvas.getContext("webgl", {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
  });
  const melt = gl ? compileMeltProgram(gl) : null;
  if (!gl || !melt) return false;

  const draw = (progress: number) => {
    gl.uniform1f(melt.progress, progress);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  gl.viewport(0, 0, canvas.width, canvas.height);
  uploadTexture(gl, 0, command);
  uploadTexture(gl, 1, command);
  draw(0);

  const pillHost = document.querySelector(".argus-mode-pill")?.parentElement;
  if (pillHost?.parentElement) pillHost.parentElement.insertBefore(canvas, pillHost);
  else document.body.append(canvas);

  try {
    await update();
    await committed();
    // Two frames: the space's effects (the silk canvas) run after its first paint.
    await nextFrame();
    await nextFrame();
    uploadTexture(gl, 1, paintSanctuary(canvas.width, canvas.height));

    await new Promise<void>((resolve) => {
      const startedAt = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - startedAt) / MELT_DURATION_MS);
        draw(meltEase(t));
        if (t < 1) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });

    canvas.style.opacity = "0";
    await new Promise((resolve) => window.setTimeout(resolve, MELT_REVEAL_MS));
  } finally {
    canvas.remove();
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
  return true;
}
