import { useAtomValue } from "@effect/atom-react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useCallback, useEffect, useEffectEvent, useRef } from "react";

import { useUpdatePrimarySettings } from "../../hooks/useSettings";
import { readThreadShell } from "../../state/entities";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import type { ThreadRouteTarget } from "../../threadRoutes";
import {
  captureThreadAgents,
  parseMosaicLayout,
  serializeMosaicLayout,
  withLocalDrafts,
} from "./mosaicLayout";
import { useMosaicStore } from "./mosaicStore";

const SAVE_DEBOUNCE_MS = 500;

export type MosaicSaveResult =
  | { readonly ok: true; readonly savedAt: string }
  | { readonly ok: false; readonly message: string };

/**
 * Keeps the mosaic in the primary server's settings so every client of that
 * server shares one layout. localStorage stays a cache for the first paint.
 * The first server copy wins over the cache; with none saved yet, this
 * client's cached layout becomes the saved one.
 *
 * Returns `saveNow` for Save configuration: it records each shown thread's
 * model, writes the layout immediately, and resolves once the server accepts it.
 */
export function useMosaicLayoutSync(routeTarget: ThreadRouteTarget) {
  const environmentId = usePrimaryEnvironmentId();
  const placeRoute = useEffectEvent(() =>
    useMosaicStore.getState().syncRouteTarget(routeTarget, "enter"),
  );
  // `undefined` until the server config loads, `null` when nothing is saved yet.
  const remote = useAtomValue(serverEnvironment.configValueAtom(environmentId))?.settings
    .argusMosaicLayout;
  const updateSettings = useUpdatePrimarySettings();
  const persistSettings = useAtomCommand(serverEnvironment.updateSettings, {
    reportFailure: false,
  });
  const save = useEffectEvent((layout: string) => updateSettings({ argusMosaicLayout: layout }));
  /** The last server value handled here, including this client's own writes. */
  const lastRemoteRef = useRef<string | null | undefined>(undefined);
  /** The serialized layout known to match the server. */
  const syncedRef = useRef<string | null>(null);
  const hydratedRef = useRef(false);

  useEffect(() => {
    if (environmentId === null || remote === undefined || remote === lastRemoteRef.current) return;
    lastRemoteRef.current = remote;
    hydratedRef.current = true;
    const store = useMosaicStore.getState();
    const layout = parseMosaicLayout(remote);
    if (layout) {
      store.applyLayout(withLocalDrafts(layout, store.panes));
      syncedRef.current = serializeMosaicLayout(useMosaicStore.getState());
      // The route's thread may not be in the saved grid; placing it can queue a save.
      placeRoute();
      return;
    }
    const local = serializeMosaicLayout(store);
    syncedRef.current = local;
    lastRemoteRef.current = local;
    save(local);
  }, [environmentId, remote]);

  useEffect(() => {
    if (environmentId === null) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      timer = null;
      if (!hydratedRef.current) return;
      const next = serializeMosaicLayout(useMosaicStore.getState());
      if (next === syncedRef.current) return;
      syncedRef.current = next;
      lastRemoteRef.current = next;
      save(next);
    };
    const unsubscribe = useMosaicStore.subscribe((state, previous) => {
      if (
        state.companies === previous.companies &&
        state.panes === previous.panes &&
        state.root === previous.root &&
        state.floating === previous.floating &&
        state.agents === previous.agents &&
        state.savedAt === previous.savedAt
      ) {
        return;
      }
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(flush, SAVE_DEBOUNCE_MS);
    });
    return () => {
      unsubscribe();
      if (timer !== null) {
        clearTimeout(timer);
        flush();
      }
    };
  }, [environmentId]);

  const saveNow = useCallback(async (): Promise<MosaicSaveResult> => {
    if (environmentId === null || !hydratedRef.current) {
      return { ok: false, message: "The server has not loaded the grid yet." };
    }
    const savedAt = new Date().toISOString();
    const store = useMosaicStore.getState();
    store.recordSave(
      captureThreadAgents(store, (threadRef) => readThreadShell(threadRef)?.modelSelection ?? null),
      savedAt,
    );
    const next = serializeMosaicLayout(useMosaicStore.getState());
    syncedRef.current = next;
    lastRemoteRef.current = next;
    const result = await persistSettings({
      environmentId,
      input: { patch: { argusMosaicLayout: next } },
    });
    if (result._tag === "Failure") {
      // Let the next change retry through the debounced save.
      syncedRef.current = null;
      const error = squashAtomCommandFailure(result);
      return {
        ok: false,
        message: error instanceof Error ? error.message : "The server rejected the save.",
      };
    }
    return { ok: true, savedAt };
  }, [environmentId, persistSettings]);

  return { saveNow, ready: environmentId !== null && remote !== undefined };
}
