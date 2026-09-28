import { useAtomValue } from "@effect/atom-react";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useCallback, useMemo } from "react";

import { stackedThreadToast, toastManager } from "../../components/ui/toast";
import { randomUUID } from "../../lib/utils";
import { readThreadShell } from "../../state/entities";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  parseMosaicConfigs,
  serializeMosaicConfigs,
  upsertMosaicConfig,
  type MosaicNamedConfig,
} from "./mosaicConfigs";
import { captureThreadAgents, parseMosaicLayout, serializeMosaicLayout } from "./mosaicLayout";
import { useMosaicStore } from "./mosaicStore";
import { collectPaneIds } from "./mosaicTree";
import { useMosaicActions } from "./useMosaicActions";

export type MosaicConfigSaveResult =
  | { readonly ok: true; readonly config: MosaicNamedConfig }
  | { readonly ok: false; readonly message: string };

/**
 * The named configurations on the primary server. Saving snapshots the live
 * grid (tree, panes, companies, floating panes, and each shown thread's model)
 * under a name; loading makes a snapshot the live grid and puts its threads
 * back on their saved models.
 */
export function useMosaicConfigs() {
  const environmentId = usePrimaryEnvironmentId();
  // `undefined` until the server config loads.
  const raw = useAtomValue(serverEnvironment.configValueAtom(environmentId))?.settings
    .argusMosaicConfigs;
  const configs = useMemo(() => parseMosaicConfigs(raw), [raw]);
  const persistSettings = useAtomCommand(serverEnvironment.updateSettings, {
    reportFailure: false,
  });
  const { applyPaneAgent, openTarget } = useMosaicActions();

  const saveConfig = useCallback(
    async (name: string): Promise<MosaicConfigSaveResult> => {
      if (environmentId === null || raw === undefined) {
        return { ok: false, message: "The server has not loaded yet." };
      }
      const savedAt = new Date().toISOString();
      const store = useMosaicStore.getState();
      store.recordSave(
        captureThreadAgents(
          store,
          (threadRef) => readThreadShell(threadRef)?.modelSelection ?? null,
        ),
        savedAt,
      );
      const next = upsertMosaicConfig(
        configs,
        { name, layout: serializeMosaicLayout(useMosaicStore.getState()), savedAt },
        randomUUID,
      );
      const result = await persistSettings({
        environmentId,
        input: { patch: { argusMosaicConfigs: serializeMosaicConfigs(next.configs) } },
      });
      if (result._tag === "Failure") {
        const error = squashAtomCommandFailure(result);
        return {
          ok: false,
          message: error instanceof Error ? error.message : "The server rejected the save.",
        };
      }
      useMosaicStore.getState().setActiveConfig(next.config.id);
      return { ok: true, config: next.config };
    },
    [configs, environmentId, persistSettings, raw],
  );

  const loadConfig = useCallback(
    (config: MosaicNamedConfig) => {
      const layout = parseMosaicLayout(config.layout);
      if (!layout) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: `Could not load "${config.name}"`,
            description: "This configuration was saved by a newer or incompatible build.",
          }),
        );
        return;
      }
      const store = useMosaicStore.getState();
      store.applyLayout(layout);
      store.setActiveConfig(config.id);
      for (const paneId of collectPaneIds(layout.root)) {
        const pane = layout.panes[paneId];
        if (pane?.kind !== "chat" || pane.target?.kind !== "server") continue;
        const agent = layout.agents[scopedThreadKey(pane.target.threadRef)];
        if (agent) void applyPaneAgent(pane, agent, `"${config.name}"`);
      }
      // Keep the route on the active pane's thread so the grid does not pull the old one back in.
      const next = useMosaicStore.getState();
      const active = next.activePaneId ? next.panes[next.activePaneId] : undefined;
      if (active?.kind === "chat" && active.target) openTarget(active.target);
    },
    [applyPaneAgent, openTarget],
  );

  return { configs, ready: environmentId !== null && raw !== undefined, saveConfig, loadConfig };
}
