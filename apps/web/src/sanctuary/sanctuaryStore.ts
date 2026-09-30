import { useEffect } from "react";
import { create } from "zustand";

import { emptySanctuary, normalizeSanctuary, type SanctuaryDocument } from "./sanctuaryModel";

export interface SanctuaryCapabilities {
  readonly simplefinConnected: boolean;
  readonly claude: boolean;
  readonly systemDictation: boolean;
}

export interface SimplefinAccountsResult {
  readonly ok: boolean;
  readonly accounts: ReadonlyArray<{
    id: string;
    name: string;
    org: string;
    currency: string;
    balance: number;
    balanceDate: number;
  }>;
  readonly errors: readonly string[];
}

/** The desktop preload's Sanctuary bridge. Absent on the web. */
export interface SanctuaryDesktopBridge {
  load(): Promise<unknown>;
  save(document: SanctuaryDocument): Promise<boolean>;
  capabilities(): Promise<SanctuaryCapabilities>;
  startDictation(): Promise<boolean>;
  connectSimplefin(setupToken: string): Promise<{ ok: boolean; error?: string }>;
  disconnectSimplefin(): Promise<void>;
  simplefinAccounts(): Promise<SimplefinAccountsResult>;
  ai(task: "food" | "ramble", text: string): Promise<unknown>;
}

declare global {
  interface Window {
    sanctuaryDesktop?: SanctuaryDesktopBridge;
  }
}

export const sanctuaryDesktop = (): SanctuaryDesktopBridge | undefined =>
  typeof window === "undefined" ? undefined : window.sanctuaryDesktop;

const WEB_STORAGE_KEY = "argus.sanctuary.v1";
const SAVE_DELAY_MS = 400;

interface SanctuaryStore {
  readonly document: SanctuaryDocument;
  readonly loaded: boolean;
  readonly capabilities: SanctuaryCapabilities;
  readonly update: (change: (document: SanctuaryDocument) => SanctuaryDocument) => void;
  readonly refreshCapabilities: () => Promise<void>;
}

const NO_CAPABILITIES: SanctuaryCapabilities = {
  simplefinConnected: false,
  claude: false,
  systemDictation: false,
};

export const useSanctuaryStore = create<SanctuaryStore>((set) => ({
  document: emptySanctuary(),
  loaded: false,
  capabilities: NO_CAPABILITIES,
  update: (change) => set((state) => ({ document: change(state.document) })),
  refreshCapabilities: async () => {
    const bridge = sanctuaryDesktop();
    if (!bridge) return;
    set({ capabilities: await bridge.capabilities().catch(() => NO_CAPABILITIES) });
  },
}));

async function readStored(): Promise<SanctuaryDocument> {
  const bridge = sanctuaryDesktop();
  if (bridge) return normalizeSanctuary(await bridge.load().catch(() => null));
  try {
    const raw = window.localStorage.getItem(WEB_STORAGE_KEY);
    return normalizeSanctuary(raw ? JSON.parse(raw) : null);
  } catch {
    return emptySanctuary();
  }
}

function writeStored(document: SanctuaryDocument) {
  const bridge = sanctuaryDesktop();
  if (bridge) {
    void bridge.save(document);
    return;
  }
  try {
    window.localStorage.setItem(WEB_STORAGE_KEY, JSON.stringify(document));
  } catch {
    // Storage full or disabled: the in-memory document still works this session.
  }
}

let started = false;

/** Loads the document once, then saves every change shortly after it settles. */
function startPersistence() {
  if (started) return;
  started = true;
  void readStored().then((stored) => {
    useSanctuaryStore.setState({ document: stored, loaded: true });
    let timer: number | undefined;
    let pending: SanctuaryDocument | null = null;
    const flush = () => {
      window.clearTimeout(timer);
      timer = undefined;
      if (pending) writeStored(pending);
      pending = null;
    };
    useSanctuaryStore.subscribe((state, previous) => {
      if (state.document === previous.document) return;
      pending = state.document;
      window.clearTimeout(timer);
      timer = window.setTimeout(flush, SAVE_DELAY_MS);
    });
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) flush();
    });
  });
  void useSanctuaryStore.getState().refreshCapabilities();
}

export function useSanctuaryPersistence() {
  useEffect(startPersistence, []);
}
