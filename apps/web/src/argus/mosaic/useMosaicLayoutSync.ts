import { useAtomValue } from "@effect/atom-react";
import { useEffect, useEffectEvent, useRef } from "react";

import { useUpdatePrimarySettings } from "../../hooks/useSettings";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { serverEnvironment } from "../../state/server";
import type { ThreadRouteTarget } from "../../threadRoutes";
import { parseMosaicLayout, serializeMosaicLayout, withLocalDrafts } from "./mosaicLayout";
import { useMosaicStore } from "./mosaicStore";

const SAVE_DEBOUNCE_MS = 500;

/**
 * Keeps the mosaic in the primary server's settings so every client of that
 * server shares one layout. localStorage stays a cache for the first paint.
 * The first server copy wins over the cache; with none saved yet, this
 * client's cached layout becomes the saved one.
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
        state.root === previous.root
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
}
