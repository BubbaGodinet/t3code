import { useEffect, useEffectEvent, useRef } from "react";

import { useUpdatePrimarySettings } from "../../hooks/useSettings";
import { usePrimaryEnvironmentId } from "../../state/environments";
import type { ThreadRouteTarget } from "../../threadRoutes";
import {
  reconcileMosaicLayout,
  serializeMosaicLayout,
  withLocalDrafts,
  type MosaicLayoutDocument,
} from "./mosaicLayout";
import { useMosaicStore } from "./mosaicStore";
import { useReportedServerSettings } from "./reportedSettings";

const SAVE_DEBOUNCE_MS = 500;

function layoutChanged(next: MosaicLayoutDocument, previous: MosaicLayoutDocument): boolean {
  return (
    next.companies !== previous.companies ||
    next.panes !== previous.panes ||
    next.root !== previous.root ||
    next.floating !== previous.floating ||
    next.agents !== previous.agents ||
    next.savedAt !== previous.savedAt
  );
}

/**
 * Keeps the live mosaic, companies included, in the primary server's settings
 * so every client of that server shares one layout and a restart brings it
 * back. localStorage stays a cache for the first paint and holds edits the
 * server has not received yet; whichever copy was edited last wins, and
 * nothing is saved until the server has reported its own copy. Named
 * configurations are separate (`useMosaicConfigs`).
 */
export function useMosaicLayoutSync(routeTarget: ThreadRouteTarget | null) {
  const environmentId = usePrimaryEnvironmentId();
  const placeRoute = useEffectEvent(() => {
    if (routeTarget) useMosaicStore.getState().syncRouteTarget(routeTarget, "enter");
  });
  // `undefined` until the server reports its config, `null` when nothing is saved yet.
  const remote = useReportedServerSettings(environmentId)?.argusMosaicLayout;
  const updateSettings = useUpdatePrimarySettings();
  const save = useEffectEvent((layout: string) => updateSettings({ argusMosaicLayout: layout }));
  /** The last server value handled here, including this client's own writes. */
  const lastRemoteRef = useRef<string | null | undefined>(undefined);
  /** The serialized layout known to match the server. */
  const syncedRef = useRef<string | null>(null);
  /** Set once the server's copy has been read; edits before that are not saved. */
  const hydratedRef = useRef(false);
  const applyingRemoteRef = useRef(false);

  // Subscribed before hydrating so the route placement right after it is saved.
  useEffect(() => {
    if (environmentId === null) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      if (!hydratedRef.current) return;
      const next = serializeMosaicLayout(useMosaicStore.getState());
      if (next === syncedRef.current) return;
      syncedRef.current = next;
      lastRemoteRef.current = next;
      save(next);
    };
    const unsubscribe = useMosaicStore.subscribe((state, previous) => {
      if (!layoutChanged(state, previous)) return;
      if (hydratedRef.current && !applyingRemoteRef.current) {
        useMosaicStore.setState({ editedAt: new Date().toISOString() });
      }
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(flush, SAVE_DEBOUNCE_MS);
    });
    const flushWhenHidden = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    document.addEventListener("visibilitychange", flushWhenHidden);
    return () => {
      unsubscribe();
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", flush);
      document.removeEventListener("visibilitychange", flushWhenHidden);
      flush();
    };
  }, [environmentId]);

  useEffect(() => {
    if (environmentId === null || remote === undefined || remote === lastRemoteRef.current) return;
    lastRemoteRef.current = remote;
    const store = useMosaicStore.getState();
    const step = reconcileMosaicLayout(remote, store);
    hydratedRef.current = step.kind !== "blocked";
    switch (step.kind) {
      case "blocked":
        console.warn("[argus] The saved mosaic is from a newer build; leaving it untouched.");
        return;
      case "apply":
        applyingRemoteRef.current = true;
        try {
          store.applyLayout(withLocalDrafts(step.layout, store.panes));
        } finally {
          applyingRemoteRef.current = false;
        }
        syncedRef.current = serializeMosaicLayout(useMosaicStore.getState());
        // The route's thread may not be in the saved grid; placing it can queue a save.
        placeRoute();
        return;
      case "push": {
        const local = serializeMosaicLayout(store);
        syncedRef.current = local;
        lastRemoteRef.current = local;
        save(local);
        return;
      }
      case "idle":
        return;
    }
  }, [environmentId, remote]);
}
