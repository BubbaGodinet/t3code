import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ModelSelection, ScopedProjectRef } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { randomUUID } from "../../lib/utils";
import { resolveStorage } from "../../lib/storage";
import type { ThreadRouteTarget } from "../../threadRoutes";
import {
  buildPresetTree,
  collectPaneIds,
  insertPaneBeside,
  removePane,
  resizeSplit,
  type MosaicDirection,
  type MosaicNode,
  type MosaicPreset,
} from "./mosaicTree";

/** A named workspace with one repository (T3 project), one default agent, and a color. */
export interface MosaicCompany {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly projectRef: ScopedProjectRef | null;
  readonly modelSelection: ModelSelection | null;
}

export type MosaicPane =
  | {
      readonly id: string;
      readonly kind: "chat";
      readonly companyId: string | null;
      readonly target: ThreadRouteTarget | null;
    }
  | {
      readonly id: string;
      readonly kind: "terminal";
      readonly companyId: string | null;
      /** Terminal sessions are keyed by thread id on the server; this one belongs to no thread. */
      readonly sessionThreadId: string;
      readonly terminalId: string;
    };

export type MosaicPaneKind = MosaicPane["kind"];

export const COMPANY_COLOR_PALETTE = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#14b8a6",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#d946ef",
  "#f43f5e",
  "#a3a3a3",
] as const;

interface MosaicLayoutSnapshot {
  readonly panes: Readonly<Record<string, MosaicPane>>;
  readonly root: MosaicNode | null;
  readonly activePaneId: string | null;
}

interface MosaicStoreState extends MosaicLayoutSnapshot {
  enabled: boolean;
  companies: ReadonlyArray<MosaicCompany>;
  setEnabled: (enabled: boolean) => void;
  applyPreset: (preset: MosaicPreset) => void;
  addPane: (
    kind: MosaicPaneKind,
    options?: { beside?: string | null; direction?: MosaicDirection; companyId?: string | null },
  ) => string;
  closePane: (paneId: string) => void;
  resize: (splitId: string, index: number, deltaPercent: number) => void;
  setActivePane: (paneId: string | null) => void;
  setPaneTarget: (paneId: string, target: ThreadRouteTarget | null) => void;
  setPaneCompany: (paneId: string, companyId: string | null) => void;
  upsertCompany: (company: MosaicCompany) => void;
  removeCompany: (companyId: string) => void;
  syncRouteTarget: (target: ThreadRouteTarget, mode: "enter" | "navigate") => void;
}

export function routeTargetKey(target: ThreadRouteTarget): string {
  return target.kind === "server" ? scopedThreadKey(target.threadRef) : `draft:${target.draftId}`;
}

function createPane(kind: MosaicPaneKind, companyId: string | null): MosaicPane {
  const id = randomUUID();
  return kind === "chat"
    ? { id, kind, companyId, target: null }
    : {
        id,
        kind,
        companyId,
        sessionThreadId: `argus-terminal-${id}`,
        terminalId: "default",
      };
}

/**
 * Decides where a route thread lands. The route always mirrors the active
 * chat pane, so a thread already on screen just takes focus; otherwise it
 * fills the active chat pane (on navigation) or the first empty chat pane,
 * and as a last resort opens a new pane beside the active one.
 */
export function placeRouteTarget(
  snapshot: MosaicLayoutSnapshot,
  target: ThreadRouteTarget,
  mode: "enter" | "navigate",
): MosaicLayoutSnapshot {
  const key = routeTargetKey(target);
  const order = collectPaneIds(snapshot.root);
  const showing = order.find((paneId) => {
    const pane = snapshot.panes[paneId];
    return pane?.kind === "chat" && pane.target !== null && routeTargetKey(pane.target) === key;
  });
  if (showing) {
    return showing === snapshot.activePaneId ? snapshot : { ...snapshot, activePaneId: showing };
  }

  const assign = (paneId: string): MosaicLayoutSnapshot => {
    const pane = snapshot.panes[paneId];
    if (pane?.kind !== "chat") return snapshot;
    return {
      ...snapshot,
      panes: { ...snapshot.panes, [paneId]: { ...pane, target } },
      activePaneId: paneId,
    };
  };

  const active = snapshot.activePaneId ? snapshot.panes[snapshot.activePaneId] : undefined;
  if (active?.kind === "chat" && (mode === "navigate" || active.target === null)) {
    return assign(active.id);
  }
  const empty = order.find((paneId) => {
    const pane = snapshot.panes[paneId];
    return pane?.kind === "chat" && pane.target === null;
  });
  if (empty) return assign(empty);
  if (mode === "enter" && snapshot.root !== null) return snapshot;

  const pane: MosaicPane = { id: randomUUID(), kind: "chat", companyId: null, target };
  return {
    panes: { ...snapshot.panes, [pane.id]: pane },
    root: insertPaneBeside(snapshot.root, snapshot.activePaneId, pane.id, "row", randomUUID),
    activePaneId: pane.id,
  };
}

export const useMosaicStore = create<MosaicStoreState>()(
  persist(
    (set, get) => ({
      enabled: false,
      companies: [],
      panes: {},
      root: null,
      activePaneId: null,
      setEnabled: (enabled) => set({ enabled }),
      applyPreset: (preset) =>
        set((state) => {
          const existing = collectPaneIds(state.root);
          const capacity =
            preset === "row" ? 1 : preset === "two-over-one" ? 3 : preset === "grid-2x2" ? 4 : 5;
          const panes = { ...state.panes };
          const ids = [...existing];
          const companyId = state.activePaneId
            ? (state.panes[state.activePaneId]?.companyId ?? null)
            : null;
          while (ids.length < capacity) {
            const pane = createPane("chat", companyId);
            panes[pane.id] = pane;
            ids.push(pane.id);
          }
          return {
            panes,
            root: buildPresetTree(preset, ids, randomUUID),
            activePaneId: state.activePaneId ?? ids[0] ?? null,
          };
        }),
      addPane: (kind, options) => {
        const state = get();
        const beside = options?.beside ?? state.activePaneId;
        const companyId =
          options?.companyId !== undefined
            ? options.companyId
            : beside
              ? (state.panes[beside]?.companyId ?? null)
              : null;
        const pane = createPane(kind, companyId);
        set({
          panes: { ...state.panes, [pane.id]: pane },
          root: insertPaneBeside(
            state.root,
            beside,
            pane.id,
            options?.direction ?? "row",
            randomUUID,
          ),
          activePaneId: pane.id,
        });
        return pane.id;
      },
      closePane: (paneId) =>
        set((state) => {
          const root = removePane(state.root, paneId);
          const { [paneId]: _removed, ...panes } = state.panes;
          const activePaneId =
            state.activePaneId === paneId ? (collectPaneIds(root)[0] ?? null) : state.activePaneId;
          return { root, panes, activePaneId };
        }),
      resize: (splitId, index, deltaPercent) =>
        set((state) => ({ root: resizeSplit(state.root, splitId, index, deltaPercent) })),
      setActivePane: (paneId) => set({ activePaneId: paneId }),
      setPaneTarget: (paneId, target) =>
        set((state) => {
          const pane = state.panes[paneId];
          if (pane?.kind !== "chat") return state;
          return { panes: { ...state.panes, [paneId]: { ...pane, target } } };
        }),
      setPaneCompany: (paneId, companyId) =>
        set((state) => {
          const pane = state.panes[paneId];
          if (!pane) return state;
          return { panes: { ...state.panes, [paneId]: { ...pane, companyId } } };
        }),
      upsertCompany: (company) =>
        set((state) => {
          const index = state.companies.findIndex((entry) => entry.id === company.id);
          if (index === -1) return { companies: [...state.companies, company] };
          const companies = [...state.companies];
          companies[index] = company;
          return { companies };
        }),
      removeCompany: (companyId) =>
        set((state) => ({
          companies: state.companies.filter((company) => company.id !== companyId),
          panes: Object.fromEntries(
            Object.entries(state.panes).map(([id, pane]) => [
              id,
              pane.companyId === companyId ? { ...pane, companyId: null } : pane,
            ]),
          ),
        })),
      syncRouteTarget: (target, mode) => set((state) => placeRouteTarget(state, target, mode)),
    }),
    {
      name: "t3code:argus-mosaic:v1",
      version: 1,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({
        enabled: state.enabled,
        companies: state.companies,
        panes: state.panes,
        root: state.root,
        activePaneId: state.activePaneId,
      }),
    },
  ),
);

// The Argus command center frames T3 with `?argus=grid` so COMMAND opens straight into the mosaic.
if (
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("argus") === "grid"
) {
  useMosaicStore.getState().setEnabled(true);
}

/** A chat pane takes its company from its thread's project when one matches, else its own pick. */
export function resolvePaneCompany(
  companies: ReadonlyArray<MosaicCompany>,
  pane: MosaicPane,
  threadProjectRef: ScopedProjectRef | null,
): MosaicCompany | null {
  if (threadProjectRef) {
    const byProject = companies.find(
      (company) =>
        company.projectRef?.environmentId === threadProjectRef.environmentId &&
        company.projectRef.projectId === threadProjectRef.projectId,
    );
    if (byProject) return byProject;
  }
  return companies.find((company) => company.id === pane.companyId) ?? null;
}
