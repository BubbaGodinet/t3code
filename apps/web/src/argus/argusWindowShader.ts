/**
 * The shared plumbing of the Command ↔ Sanctuary shader transitions: a snapshot
 * of the window, and a full-window WebGL canvas that sits just under the mode
 * pill, so the pill stays live and undistorted on top.
 */

/** Room around the pill left out of the snapshot, for its border and shadow. */
const PILL_MARGIN_PX = 4;

const FULL_WINDOW_VERTEX_SHADER = `
attribute vec2 aPosition;
varying vec2 vUv;

void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

/**
 * Snapshots the window through the desktop bridge, with the pill's area filled
 * from the row beneath it so no shader distorts a copy of the pill. Null on the
 * web, where the page cannot be captured.
 */
export async function captureArgusWindow(): Promise<HTMLCanvasElement | null> {
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

export interface ArgusShaderOverlay {
  readonly canvas: HTMLCanvasElement;
  readonly gl: WebGLRenderingContext;
  readonly program: WebGLProgram;
  /** Draws one frame with `progress` in the fragment shader's progress uniform. */
  readonly draw: (progress: number) => void;
  /** Uploads `source` into texture unit `unit`. */
  readonly upload: (unit: number, source: HTMLCanvasElement) => void;
  /** Puts the canvas on screen, just under the mode pill. */
  readonly mount: () => void;
  readonly dispose: () => void;
}

/**
 * A window-covering canvas running `fragmentShader` over a full-window triangle
 * whose `vUv` runs 0 to 1. Null when WebGL or the shader is unavailable, so the
 * caller can fall back. `alpha` lets the page show through transparent pixels.
 */
export function createArgusShaderOverlay(options: {
  readonly width: number;
  readonly height: number;
  readonly fragmentShader: string;
  readonly progressUniform: string;
  readonly alpha: boolean;
}): ArgusShaderOverlay | null {
  const canvas = document.createElement("canvas");
  canvas.width = options.width;
  canvas.height = options.height;
  canvas.setAttribute("aria-hidden", "true");
  Object.assign(canvas.style, {
    position: "fixed",
    inset: "0",
    width: "100%",
    height: "100%",
    zIndex: "39",
    pointerEvents: "none",
  });
  const gl = canvas.getContext("webgl", {
    alpha: options.alpha,
    antialias: false,
    depth: false,
    stencil: false,
  });
  if (!gl) return null;

  const shader = (type: number, source: string) => {
    const created = gl.createShader(type);
    if (!created) return null;
    gl.shaderSource(created, source);
    gl.compileShader(created);
    return created;
  };
  const vertex = shader(gl.VERTEX_SHADER, FULL_WINDOW_VERTEX_SHADER);
  const fragment = shader(gl.FRAGMENT_SHADER, options.fragmentShader);
  const program = gl.createProgram();
  const lose = () => gl.getExtension("WEBGL_lose_context")?.loseContext();
  if (!vertex || !fragment || !program) {
    lose();
    return null;
  }
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    lose();
    return null;
  }

  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, "aPosition");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  gl.viewport(0, 0, canvas.width, canvas.height);
  const progress = gl.getUniformLocation(program, options.progressUniform);

  return {
    canvas,
    gl,
    program,
    draw: (value) => {
      gl.uniform1f(progress, value);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    upload: (unit, source) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    },
    mount: () => {
      const pillHost = document.querySelector(".argus-mode-pill")?.parentElement;
      if (pillHost?.parentElement) pillHost.parentElement.insertBefore(canvas, pillHost);
      else document.body.append(canvas);
    },
    dispose: () => {
      canvas.remove();
      lose();
    },
  };
}

export const nextFrame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** Calls `frame` with linear time from 0 to 1 over `durationMs`, once per display frame. */
export function animateArgusShader(durationMs: number, frame: (t: number) => void): Promise<void> {
  return new Promise((resolve) => {
    const startedAt = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - startedAt) / durationMs);
      frame(t);
      if (t < 1) requestAnimationFrame(tick);
      else resolve();
    };
    requestAnimationFrame(tick);
  });
}
