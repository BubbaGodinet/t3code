import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";

import { terminalEnvironment } from "../../state/terminal";
import { useAtomCommand } from "../../state/use-atom-command";
import { buildThreadRouteParams, type ThreadRouteTarget } from "../../threadRoutes";
import { collectPaneIds } from "./mosaicTree";
import { useMosaicStore } from "./mosaicStore";

/** Pane focus and close. Focusing a chat pane moves the route to its thread. */
export function useMosaicActions() {
  const navigate = useNavigate();
  const closeTerminal = useAtomCommand(terminalEnvironment.close, "terminal close");

  const openTarget = useCallback(
    (target: ThreadRouteTarget) => {
      if (target.kind === "server") {
        void navigate({
          to: "/$environmentId/$threadId",
          params: buildThreadRouteParams(target.threadRef),
          replace: true,
        });
      } else {
        void navigate({
          to: "/draft/$draftId",
          params: { draftId: target.draftId },
          replace: true,
        });
      }
    },
    [navigate],
  );

  const focusPane = useCallback(
    (paneId: string) => {
      const { activePaneId, panes, setActivePane } = useMosaicStore.getState();
      if (activePaneId === paneId) return;
      setActivePane(paneId);
      const pane = panes[paneId];
      if (pane?.kind === "chat" && pane.target) openTarget(pane.target);
    },
    [openTarget],
  );

  const closePane = useCallback(
    (paneId: string) => {
      const state = useMosaicStore.getState();
      const pane = state.panes[paneId];
      if (pane?.kind === "terminal") {
        const company = state.companies.find((entry) => entry.id === pane.companyId);
        if (company?.projectRef) {
          void closeTerminal({
            environmentId: company.projectRef.environmentId,
            input: { threadId: pane.sessionThreadId, deleteHistory: true },
          });
        }
      }
      const wasActive = state.activePaneId === paneId;
      state.closePane(paneId);
      if (!wasActive) return;
      const next = useMosaicStore.getState();
      const nextPane = next.activePaneId ? next.panes[next.activePaneId] : undefined;
      if (nextPane?.kind === "chat" && nextPane.target) openTarget(nextPane.target);
      else if (collectPaneIds(next.root).length === 0) next.setActivePane(null);
    },
    [closeTerminal, openTarget],
  );

  return { focusPane, closePane, openTarget };
}
