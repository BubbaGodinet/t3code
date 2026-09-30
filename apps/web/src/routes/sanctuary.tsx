import { createFileRoute, redirect } from "@tanstack/react-router";
import { type RefObject, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { provideSanctuarySnapshot } from "../argus/argusMelt";
import { ARGUS_SANCTUARY_SPACE_ATTRIBUTE } from "../argus/argusModeTransition";
import { isElectron } from "../env";
import { cn } from "../lib/utils";
import { SanctuarySpace } from "../sanctuary/SanctuarySpace";

/** React Bits Silk at #3e356e: speed 5, scale 1, noise 1.5, rotation 0. */
const SILK_COLOR = [0x3e / 255, 0x35 / 255, 0x6e / 255] as const;
const SILK_MAX_PIXEL_RATIO = 1.5;
/** The silk drifts slowly, so 30fps is indistinguishable from the display rate. */
const SILK_FRAME_MS = 1000 / 30;
/** React Bits advances the shader clock by 0.1 per second. */
const SILK_CLOCK_RATE = 0.1;

const SILK_VERTEX_SHADER = `
attribute vec2 aPosition;
varying vec2 vUv;

void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const SILK_FRAGMENT_SHADER = `
precision highp float;

varying vec2 vUv;

uniform float uTime;
uniform vec3 uColor;

const float uSpeed = 5.0;
const float uScale = 1.0;
const float uRotation = 0.0;
const float uNoiseIntensity = 1.5;
const float e = 2.71828182845904523536;

float noise(vec2 texCoord) {
  float G = e;
  vec2 r = (G * sin(G * texCoord));
  return fract(r.x * r.y * (1.0 + texCoord.x));
}

vec2 rotateUvs(vec2 uv, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  mat2 rot = mat2(c, -s, s, c);
  return rot * uv;
}

void main() {
  float rnd = noise(gl_FragCoord.xy);
  vec2 uv = rotateUvs(vUv * uScale, uRotation);
  vec2 tex = uv * uScale;
  float tOffset = uSpeed * uTime;

  tex.y += 0.03 * sin(8.0 * tex.x - tOffset);

  float pattern = 0.6 +
                  0.4 * sin(5.0 * (tex.x + tex.y +
                                   cos(3.0 * tex.x + 5.0 * tex.y) +
                                   0.02 * tOffset) +
                           sin(20.0 * (tex.x + tex.y - 0.1 * tOffset)));

  float grain = rnd / 15.0 * uNoiseIntensity;
  gl_FragColor = vec4(clamp(uColor * pattern - vec3(grain), 0.0, 1.0), 1.0);
}
`;

function compileSilkProgram(gl: WebGLRenderingContext) {
  const shader = (type: number, source: string) => {
    const created = gl.createShader(type);
    if (!created) return null;
    gl.shaderSource(created, source);
    gl.compileShader(created);
    return created;
  };
  const vertex = shader(gl.VERTEX_SHADER, SILK_VERTEX_SHADER);
  const fragment = shader(gl.FRAGMENT_SHADER, SILK_FRAGMENT_SHADER);
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
  gl.uniform3f(gl.getUniformLocation(program, "uColor"), ...SILK_COLOR);
  return { time: gl.getUniformLocation(program, "uTime") };
}

/**
 * Draws the silk into one canvas inside `host`. It runs at 30fps, pauses while the
 * window is hidden, and holds a still frame under reduced motion. The returned ref
 * draws the current frame and hands back the canvas, for the split to copy.
 */
function useSanctuarySilk(host: RefObject<HTMLDivElement | null>) {
  const currentFrame = useRef<(() => HTMLCanvasElement) | null>(null);
  useEffect(() => {
    const hostElement = host.current;
    if (!hostElement) return;
    const canvas = document.createElement("canvas");
    canvas.className = "absolute inset-0 size-full";
    const gl = canvas.getContext("webgl", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: "low-power",
    });
    if (!gl) return;
    let silk = compileSilkProgram(gl);
    if (!silk) return;
    hostElement.append(canvas);

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let clock = 0;
    let lastFrameAt = 0;
    let frame = 0;

    const draw = () => {
      if (!silk || gl.isContextLost()) return;
      gl.uniform1f(silk.time, clock);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    const root = document.documentElement;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      // Held while melting in, so the melt's painting of Sanctuary still matches when it fades away.
      if (root.dataset.argusModeTransition === "melt") {
        lastFrameAt = now;
        return;
      }
      const elapsed = now - lastFrameAt;
      if (elapsed < SILK_FRAME_MS) return;
      clock += (SILK_CLOCK_RATE * Math.min(elapsed, 100)) / 1000;
      lastFrameAt = now;
      draw();
    };
    const sync = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      if (reducedMotion.matches || document.hidden || !silk) {
        draw();
        return;
      }
      lastFrameAt = performance.now();
      frame = requestAnimationFrame(tick);
    };
    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, SILK_MAX_PIXEL_RATIO);
      const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
      const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
      if (canvas.width === width && canvas.height === height) return;
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
      draw();
    };

    currentFrame.current = () => {
      draw();
      return canvas;
    };

    const onContextLost = (event: Event) => {
      event.preventDefault();
      silk = null;
      sync();
    };
    const onContextRestored = () => {
      silk = compileSilkProgram(gl);
      canvas.width = 0;
      resize();
      sync();
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    reducedMotion.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    canvas.addEventListener("webglcontextlost", onContextLost);
    canvas.addEventListener("webglcontextrestored", onContextRestored);
    resize();
    sync();

    return () => {
      currentFrame.current = null;
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      reducedMotion.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", sync);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      canvas.removeEventListener("webglcontextrestored", onContextRestored);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      canvas.remove();
    };
  }, [host]);
  return currentFrame;
}

/** Where the glass panel sits in the window, shared by the panel, its content, and the split halves. */
const GLASS_FRAME =
  "absolute inset-x-[max(1.5rem,calc((100%_-_72rem)/2))] top-[calc(var(--workspace-topbar-height)_+_1rem)] bottom-8 rounded-[20px]";

function mirrorSilk(
  canvas: HTMLCanvasElement,
  left: HTMLCanvasElement | null,
  right: HTMLCanvasElement | null,
) {
  const half = Math.round(canvas.width / 2);
  const copy = (mirror: HTMLCanvasElement | null, sourceX: number, width: number) => {
    if (!mirror) return;
    mirror.width = width;
    mirror.height = canvas.height;
    mirror
      .getContext("2d")
      ?.drawImage(canvas, sourceX, 0, width, canvas.height, 0, 0, width, canvas.height);
  };
  copy(left, 0, half);
  copy(right, half, canvas.width - half);
}

/**
 * Sanctuary without its content, for the melt to melt into: the silk frame, and
 * the glass panel drawn with the same filter and tint as `.argus-sanctuary-glass`.
 */
function paintSanctuary(
  silk: HTMLCanvasElement | null,
  glass: HTMLElement | null,
  width: number,
  height: number,
): HTMLCanvasElement | null {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  const paintSilk = () => {
    if (silk) context.drawImage(silk, 0, 0, width, height);
    else context.fillRect(0, 0, width, height);
  };
  context.fillStyle = "#3e356e";
  paintSilk();
  if (!glass) return canvas;

  const scale = width / window.innerWidth;
  const rect = glass.getBoundingClientRect();
  const x = rect.left * scale;
  const y = rect.top * scale;
  const panelWidth = rect.width * scale;
  const panelHeight = rect.height * scale;
  const panel = () => {
    context.beginPath();
    context.roundRect(x, y, panelWidth, panelHeight, 20 * scale);
  };
  context.save();
  panel();
  context.clip();
  context.filter = `blur(${28 * scale}px) contrast(0.55) brightness(1.6) saturate(1.2)`;
  paintSilk();
  context.filter = "none";
  context.fillStyle = "rgb(255 255 255 / 0.24)";
  context.fillRect(x, y, panelWidth, panelHeight);
  context.restore();
  panel();
  context.lineWidth = scale;
  context.strokeStyle = "rgb(255 255 255 / 0.45)";
  context.stroke();
  return canvas;
}

/**
 * One half of Sanctuary, mounted only while it splits open onto Command. Each
 * half clips its own copy of the silk frame and the glass panel, so the view
 * transition carries them apart down the middle.
 */
function SanctuaryHalf({
  side,
  mirror,
}: {
  side: "left" | "right";
  mirror: RefObject<HTMLCanvasElement | null>;
}) {
  return (
    <div
      aria-hidden
      className={cn(
        "absolute inset-y-0 w-1/2 overflow-hidden bg-[#3e356e]",
        side === "left" ? "argus-sanctuary-left left-0" : "argus-sanctuary-right right-0",
      )}
    >
      <canvas ref={mirror} className="absolute inset-0 size-full" />
      <div className={cn("absolute inset-y-0 w-[200%]", side === "left" ? "left-0" : "right-0")}>
        <div className={cn(GLASS_FRAME, "argus-sanctuary-glass")} />
      </div>
    </div>
  );
}

/**
 * Mounts the split halves only once a split transition begins, before the view
 * transition captures the old state, and fills them with the current silk frame.
 * At rest Sanctuary is one silk canvas under one glass panel.
 */
function useSanctuarySplit(silkFrame: RefObject<(() => HTMLCanvasElement) | null>) {
  const [splitting, setSplitting] = useState(false);
  const leftMirror = useRef<HTMLCanvasElement>(null);
  const rightMirror = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      const next = root.dataset.argusModeTransition === "split";
      flushSync(() => setSplitting(next));
      const canvas = next ? silkFrame.current?.() : null;
      if (canvas) mirrorSilk(canvas, leftMirror.current, rightMirror.current);
    });
    observer.observe(root, { attributes: true, attributeFilter: ["data-argus-mode-transition"] });
    return () => observer.disconnect();
  }, [silkFrame]);
  return { splitting, leftMirror, rightMirror };
}

/**
 * Argus Sanctuary inside the app window, for desktop and unframed web. Its own
 * full-window space outside the command shell: no sidebar, no work chrome. The
 * root's mode pill floats above it. Silk behind a single hazy glass panel; the
 * Sanctuary space sits on the glass.
 */
function SanctuaryRouteView() {
  const silkHost = useRef<HTMLDivElement>(null);
  const glass = useRef<HTMLDivElement>(null);
  const silkFrame = useSanctuarySilk(silkHost);
  const { splitting, leftMirror, rightMirror } = useSanctuarySplit(silkFrame);
  useEffect(
    () =>
      provideSanctuarySnapshot((width, height) =>
        paintSanctuary(silkFrame.current?.() ?? null, glass.current, width, height),
      ),
    [silkFrame],
  );

  return (
    <div
      {...{ [ARGUS_SANCTUARY_SPACE_ATTRIBUTE]: "" }}
      className="relative h-dvh min-h-0 w-full overflow-hidden overscroll-y-none bg-[#3e356e] text-ink isolate"
    >
      <div ref={silkHost} aria-hidden className="absolute inset-0" />
      <div ref={glass} aria-hidden className={cn(GLASS_FRAME, "argus-sanctuary-glass")} />
      {splitting && (
        <>
          <SanctuaryHalf side="left" mirror={leftMirror} />
          <SanctuaryHalf side="right" mirror={rightMirror} />
        </>
      )}
      <main className={cn(GLASS_FRAME, "overflow-hidden")}>
        <SanctuarySpace />
      </main>
      <header
        className={cn(
          "relative h-[var(--workspace-topbar-height)] min-h-[var(--workspace-topbar-height)]",
          isElectron && "drag-region",
        )}
      />
    </div>
  );
}

export const Route = createFileRoute("/sanctuary")({
  beforeLoad: async ({ context }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    ) {
      throw redirect({ to: "/pair", replace: true });
    }
  },
  component: SanctuaryRouteView,
});
