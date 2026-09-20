import { contextBridge, ipcRenderer } from "electron";

import {
  ARGUS_CLOSE_VIEW_CHANNEL,
  ARGUS_DOCK_CHANNEL,
  ARGUS_OPEN_SURFACE_CHANNEL,
  ARGUS_OPEN_TERMINAL_CHANNEL,
  ARGUS_OPEN_THREAD_CHANNEL,
  ARGUS_POP_OUT_CHANNEL,
  ARGUS_SYNC_VIEW_CHANNEL,
} from "./channels.ts";

contextBridge.exposeInMainWorld("argusDesktop", {
  openSurface: (target: unknown, placement: unknown) =>
    ipcRenderer.invoke(ARGUS_OPEN_SURFACE_CHANNEL, target, placement),
  popOut: (target: unknown) => ipcRenderer.invoke(ARGUS_POP_OUT_CHANNEL, target),
  dock: (target: unknown) => ipcRenderer.invoke(ARGUS_DOCK_CHANNEL, target),
  openThreadWindow: (thread: unknown) => ipcRenderer.invoke(ARGUS_OPEN_THREAD_CHANNEL, thread),
  openTerminal: (target: unknown, placement?: unknown) =>
    ipcRenderer.invoke(ARGUS_OPEN_TERMINAL_CHANNEL, target, placement),
  syncView: (view: unknown) => ipcRenderer.invoke(ARGUS_SYNC_VIEW_CHANNEL, view),
  closeView: (id: unknown) => ipcRenderer.invoke(ARGUS_CLOSE_VIEW_CHANNEL, id),
});
