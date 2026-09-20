import * as Path from "node:path";

import { BrowserWindow, WebContentsView, ipcMain, screen, type Rectangle } from "electron";

import {
  ARGUS_CLOSE_VIEW_CHANNEL,
  ARGUS_DOCK_CHANNEL,
  ARGUS_OPEN_SURFACE_CHANNEL,
  ARGUS_OPEN_TERMINAL_CHANNEL,
  ARGUS_OPEN_THREAD_CHANNEL,
  ARGUS_POP_OUT_CHANNEL,
  ARGUS_SYNC_VIEW_CHANNEL,
} from "./channels.ts";
import { agentHue, chromeCss } from "./colors.ts";
import { DEFAULT_ARGUS_ORIGIN, ensureArgusHost } from "./host.ts";
import { LayoutStore, layoutPath, type Placement, type SurfaceTarget } from "./layout-store.ts";
import { flattenLeaves, insertTile, layoutTiles, normalizePlacement, removeTile } from "./tiles.ts";
import type { NativeViewRequest, ThreadRequest } from "./types.ts";

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function isArgusHref(href: string, origin: string): boolean {
  if (href.startsWith("/")) return true;
  return href.startsWith(origin);
}

export class ArgusWindowManager {
  private readonly views = new Map<string, WebContentsView>();
  private readonly synced = new Set<string>();
  private readonly floats = new Map<string, BrowserWindow>();
  private readonly threads = new Map<string, BrowserWindow>();
  private readonly store: LayoutStore;
  private argusOrigin = DEFAULT_ARGUS_ORIGIN;
  private workspace = "global";

  constructor(
    private readonly main: BrowserWindow,
    userData: string,
    private readonly t3Origin?: string,
    private readonly preloadPath?: string,
  ) {
    this.store = new LayoutStore(layoutPath(userData));
  }

  attach() {
    ipcMain.handle(ARGUS_OPEN_SURFACE_CHANNEL, (_event, target: SurfaceTarget, placement: Placement) =>
      this.openSurface(target, placement),
    );
    ipcMain.handle(ARGUS_POP_OUT_CHANNEL, (_event, target: SurfaceTarget) => this.popOut(target));
    ipcMain.handle(ARGUS_DOCK_CHANNEL, (_event, target: SurfaceTarget) => this.dock(target));
    ipcMain.handle(ARGUS_OPEN_THREAD_CHANNEL, (_event, thread: ThreadRequest) => this.openThread(thread));
    ipcMain.handle(ARGUS_OPEN_TERMINAL_CHANNEL, (_event, target: SurfaceTarget, placement?: Placement) =>
      this.openTerminal(target, placement),
    );
    ipcMain.handle(ARGUS_SYNC_VIEW_CHANNEL, (_event, view: NativeViewRequest) => this.syncView(view));
    ipcMain.handle(ARGUS_CLOSE_VIEW_CHANNEL, (_event, id: string) => this.closeView(id));
    this.main.on("resize", () => this.layoutOwnedTiles());
    this.main.on("closed", () => this.dispose());
    this.captureArgusNavigations();
    void this.bootArgus();
  }

  async bootArgus() {
    this.argusOrigin = await ensureArgusHost(DEFAULT_ARGUS_ORIGIN);
    this.captureArgusNavigations();
  }

  openSurface(target: SurfaceTarget, placement: Placement) {
    const next = normalizePlacement(placement);
    this.workspace = target.workspaceSlug ?? this.workspace;
    const layout = this.store.read(this.workspace);
    layout.lastPlacement = next;
    this.store.write(this.workspace, layout);

    if (target.kind === "web" || (isHttpUrl(target.href) && !isArgusHref(target.href, this.argusOrigin))) {
      if (next === "float") return this.popOut(target);
      if (next === "page") return this.dock({ ...target, kind: "web" }, "tile-right");
      return this.dock({ ...target, kind: "web" }, next);
    }

    if (target.kind === "terminal") {
      return this.openTerminal(target, next);
    }

    if (next === "float") return this.popOut(target);
    if (next === "page") {
      const url = this.pageUrl(target.href);
      if (this.isArgusMain()) {
        void this.main.loadURL(url);
        return;
      }
      return this.dock(target, "tile-right");
    }

    return this.dock(target, next);
  }

  dock(target: SurfaceTarget, placement: Placement = "tile-right") {
    const next = normalizePlacement(placement === "page" ? "tile-right" : placement);
    if (next === "float") return this.popOut(target);
    this.workspace = target.workspaceSlug ?? this.workspace;
    const layout = this.store.read(this.workspace);
    layout.lastPlacement = next;
    layout.tiles = insertTile(layout.tiles, target, next);
    this.store.write(this.workspace, layout);
    this.ensureView(target);
    this.layoutOwnedTiles();
  }

  popOut(target: SurfaceTarget) {
    const existing = this.floats.get(target.id);
    if (existing && !existing.isDestroyed()) {
      existing.focus();
      return;
    }
    this.workspace = target.workspaceSlug ?? this.workspace;
    const layout = this.store.read(this.workspace);
    layout.lastPlacement = "float";
    this.store.write(this.workspace, layout);
    const saved = layout.windows[target.id];
    const window = this.createChromeWindow({
      title: target.title,
      url: this.urlFor(target),
      color: target.provider ? agentHue(target.provider) : "#8b9cff",
      bounds: saved,
      css: target.provider ? chromeCss(target.provider, "working") : undefined,
    });
    this.keepInside(window, target.kind);
    this.floats.set(target.id, window);
    window.on("close", () => {
      this.persistBounds(this.workspace, target.id, window);
      this.floats.delete(target.id);
    });
  }

  openThread(thread: ThreadRequest) {
    const existing = this.threads.get(thread.threadId);
    if (existing && !existing.isDestroyed()) {
      existing.focus();
      return;
    }
    const target: SurfaceTarget = {
      id: `thread:${thread.threadId}`,
      kind: "thread",
      href: thread.href ?? this.threadUrl(thread),
      title: `${thread.title} · ${thread.provider}`,
      provider: thread.provider,
      threadId: thread.threadId,
    };
    const window = this.createChromeWindow({
      title: target.title,
      url: this.threadUrl(thread),
      color: agentHue(thread.provider, thread.status),
      css: chromeCss(thread.provider, thread.status ?? "working"),
    });
    this.threads.set(thread.threadId, window);
    window.on("closed", () => this.threads.delete(thread.threadId));
  }

  openTerminal(target: SurfaceTarget, placement: Placement = "tile-bottom") {
    const next = normalizePlacement(placement === "page" ? "tile-bottom" : placement);
    const surface: SurfaceTarget = {
      ...target,
      id: target.id || `term:${target.workspaceSlug ?? "global"}`,
      kind: "terminal",
      title: target.title || "Terminal",
      href: target.href || this.terminalUrl(target.workspaceSlug),
    };
    if (next === "float") return this.popOut(surface);
    this.dock(surface, next);
  }

  syncView(view: NativeViewRequest) {
    this.synced.add(view.id);
    const target: SurfaceTarget = {
      id: view.id,
      kind: view.kind,
      href: view.href,
      title: view.title,
      workspaceSlug: view.workspaceSlug,
    };
    const slot = this.ensureView(target);
    slot.setBounds(this.clampRect(view.bounds));
  }

  closeView(id: string) {
    this.synced.delete(id);
    const view = this.views.get(id);
    if (view) {
      this.main.contentView.removeChildView(view);
      this.views.delete(id);
    }
    const layout = this.store.read(this.workspace);
    layout.tiles = removeTile(layout.tiles, id);
    this.store.write(this.workspace, layout);
    this.layoutOwnedTiles();
  }

  private layoutOwnedTiles() {
    if (this.main.isDestroyed()) return;
    const layout = this.store.read(this.workspace);
    if (!layout.tiles) return;
    const content = this.main.getContentBounds();
    const area = { x: 0, y: 0, width: content.width, height: content.height };
    for (const placed of layoutTiles(layout.tiles, area)) {
      if (this.synced.has(placed.id)) continue;
      const view = this.views.get(placed.id) ?? this.ensureView(placed.surface);
      view.setBounds(this.clampRect(placed.bounds));
    }
    const live = new Set(flattenLeaves(layout.tiles).map((leaf) => leaf.id));
    for (const [id, view] of this.views) {
      if (this.synced.has(id) || live.has(id)) continue;
      this.main.contentView.removeChildView(view);
      this.views.delete(id);
    }
  }

  private ensureView(target: SurfaceTarget): WebContentsView {
    const existing = this.views.get(target.id);
    if (existing) return existing;
    const view = new WebContentsView({
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        preload: this.preload(),
      },
    });
    this.keepInside(view, target.kind);
    void view.webContents.loadURL(this.urlFor(target));
    if (target.kind === "thread" && target.provider) {
      view.webContents.on("did-finish-load", () => {
        void view.webContents.insertCSS(chromeCss(target.provider!, "working"));
      });
    }
    this.main.contentView.addChildView(view);
    this.views.set(target.id, view);
    return view;
  }

  private urlFor(target: SurfaceTarget): string {
    if (target.kind === "web" && isHttpUrl(target.href)) return target.href;
    if (target.kind === "terminal") return this.terminalUrl(target.workspaceSlug, target.href);
    if (target.kind === "thread" || target.kind === "code") {
      if (isHttpUrl(target.href) || target.href.startsWith(this.t3Origin ?? "t3code")) return target.href;
    }
    return this.panelUrl(target.href);
  }

  private terminalUrl(workspaceSlug?: string, href?: string): string {
    if (this.t3Origin) return this.t3Origin;
    if (href) return this.panelUrl(href);
    const slug = workspaceSlug && workspaceSlug !== "global" ? workspaceSlug : "tether";
    return this.panelUrl(`/w/${slug}/terminal`);
  }

  private threadUrl(thread: ThreadRequest): string {
    if (this.t3Origin && thread.environmentId) {
      return `${this.t3Origin}#/${thread.environmentId}/${thread.threadId}`;
    }
    if (thread.href) return isHttpUrl(thread.href) ? thread.href : this.panelUrl(thread.href);
    return this.panelUrl(`/w/tether/project?thread=${encodeURIComponent(thread.threadId)}`);
  }

  private panelUrl(href: string): string {
    const url = new URL(href, this.argusOrigin);
    url.searchParams.set("surface", "panel");
    return url.toString();
  }

  private pageUrl(href: string): string {
    const url = new URL(href, this.argusOrigin);
    url.searchParams.delete("surface");
    return url.toString();
  }

  private createChromeWindow(input: {
    title: string;
    url: string;
    color: string;
    bounds?: { x: number; y: number; width: number; height: number };
    css?: string;
  }): BrowserWindow {
    const work = screen.getPrimaryDisplay().workArea;
    const window = new BrowserWindow({
      title: input.title,
      x: input.bounds?.x ?? Math.round(work.x + work.width * 0.12),
      y: input.bounds?.y ?? Math.round(work.y + work.height * 0.1),
      width: input.bounds?.width ?? 1080,
      height: input.bounds?.height ?? 820,
      backgroundColor: "#05060a",
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 16, y: 14 },
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        preload: this.preload(),
      },
      show: false,
    });
    window.setTitle(input.title);
    void window.loadURL(input.url);
    if (input.css) {
      window.webContents.on("did-finish-load", () => {
        void window.webContents.insertCSS(input.css!);
      });
    }
    window.once("ready-to-show", () => window.show());
    return window;
  }

  private keepInside(host: BrowserWindow | WebContentsView, kind?: string) {
    if (kind === "thread" || kind === "code") return;
    if (kind === "terminal" && this.t3Origin) return;
    const contents = host.webContents;
    contents.setWindowOpenHandler(({ url }) => {
      if (this.shouldLeaveToT3(url)) return { action: "deny" };
      this.openSurface(this.webTarget(url), this.lastPlacement() === "page" ? "tile-right" : this.lastPlacement());
      return { action: "deny" };
    });
    contents.on("will-navigate", (event, url) => {
      if (this.shouldLeaveToT3(url) || this.isOurSurface(url)) return;
      if (isHttpUrl(url)) {
        event.preventDefault();
        this.openSurface(this.webTarget(url), "tile-right");
      }
    });
  }

  private captureArgusNavigations() {
    const contents = this.main.webContents;
    contents.on("did-finish-load", () => {
      if (!this.isArgusMain()) return;
      contents.setWindowOpenHandler(({ url }) => {
        if (this.shouldLeaveToT3(url)) return { action: "deny" };
        this.openSurface(this.webTarget(url), "tile-right");
        return { action: "deny" };
      });
    });
  }

  private shouldLeaveToT3(url: string): boolean {
    if (url.startsWith("t3code://") || url.startsWith("t3code-dev://")) return true;
    if (this.t3Origin && url.startsWith(this.t3Origin)) return true;
    return false;
  }

  private isOurSurface(url: string): boolean {
    return url.startsWith(this.argusOrigin) || this.shouldLeaveToT3(url);
  }

  private webTarget(href: string): SurfaceTarget {
    let title = href;
    try {
      title = new URL(href).hostname.replace(/^www\./, "");
    } catch {
      /* keep href */
    }
    return { id: `web:${href}`, kind: "web", href, title };
  }

  private lastPlacement(): Placement {
    return this.store.read(this.workspace).lastPlacement;
  }

  private clampRect(bounds: { x: number; y: number; width: number; height: number }): Rectangle {
    return {
      x: Math.max(0, Math.round(bounds.x)),
      y: Math.max(0, Math.round(bounds.y)),
      width: Math.max(120, Math.round(bounds.width)),
      height: Math.max(120, Math.round(bounds.height)),
    };
  }

  private persistBounds(workspace: string, id: string, window: BrowserWindow) {
    if (window.isDestroyed()) return;
    const layout = this.store.read(workspace);
    const [x, y] = window.getPosition();
    const [width, height] = window.getSize();
    layout.windows[id] = { x, y, width, height };
    this.store.write(workspace, layout);
  }

  private isArgusMain(): boolean {
    try {
      return this.main.webContents.getURL().startsWith(this.argusOrigin);
    } catch {
      return false;
    }
  }

  private preload(): string {
    return this.preloadPath ?? Path.join(Path.dirname(__dirname), "preload.cjs");
  }

  private dispose() {
    for (const view of this.views.values()) {
      this.main.contentView.removeChildView(view);
    }
    this.views.clear();
    for (const window of this.floats.values()) {
      if (!window.isDestroyed()) window.close();
    }
    for (const window of this.threads.values()) {
      if (!window.isDestroyed()) window.close();
    }
  }
}

export function attachArgusWindowManager(
  main: BrowserWindow,
  userData: string,
  t3Origin?: string,
  preloadPath?: string,
) {
  const manager = new ArgusWindowManager(main, userData, t3Origin, preloadPath);
  manager.attach();
  return manager;
}

export function argusPreloadPath(): string {
  return Path.join(__dirname, "preload.cjs");
}
