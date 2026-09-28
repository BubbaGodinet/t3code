import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";

import { stackedThreadToast, toastManager } from "../../components/ui/toast";
import { useComposerDraftStore } from "../../composerDraftStore";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { readThreadShell } from "../../state/entities";
import { environmentServerConfigsAtom } from "../../state/server";
import { terminalEnvironment } from "../../state/terminal";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { buildThreadRouteParams, type ThreadRouteTarget } from "../../threadRoutes";
import { planCompanyAgentForThread } from "./companyAgent";
import { collectPaneIds } from "./mosaicTree";
import { useMosaicStore, type MosaicCompany, type MosaicPane } from "./mosaicStore";

/** Pane focus and close. Focusing a chat pane moves the route to its thread. */
export function useMosaicActions() {
  const navigate = useNavigate();
  const closeTerminal = useAtomCommand(terminalEnvironment.close, "terminal close");
  const updateThreadMetadata = useAtomCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });

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

  /**
   * Moves the chat in `pane` onto the company's agent: a draft takes it in its
   * composer, a server thread through `thread.meta.update` like T3's model picker.
   */
  const applyCompanyAgent = useCallback(
    async (pane: MosaicPane, company: MosaicCompany) => {
      const agent = company.modelSelection;
      if (pane.kind !== "chat" || pane.target === null || agent === null) return;
      const drafts = useComposerDraftStore.getState();
      if (pane.target.kind === "draft") {
        drafts.setModelSelection(pane.target.draftId, agent, {
          explicit: true,
          replaceOptions: true,
        });
        return;
      }
      const threadRef = pane.target.threadRef;
      const thread = readThreadShell(threadRef);
      if (!thread) return;
      const plan = planCompanyAgentForThread({
        companyAgent: agent,
        thread,
        providers:
          appAtomRegistry.get(environmentServerConfigsAtom).get(threadRef.environmentId)
            ?.providers ?? [],
      });
      if (plan.kind === "unchanged") return;
      if (plan.kind === "blocked") {
        toastManager.add(
          stackedThreadToast({
            type: "warning",
            title: plan.title,
            description: plan.description,
          }),
        );
        return;
      }
      const result = await updateThreadMetadata({
        environmentId: threadRef.environmentId,
        input: { threadId: threadRef.threadId, modelSelection: plan.modelSelection },
      });
      if (result._tag === "Failure") {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: `Could not switch to ${company.name}'s agent`,
            description: error instanceof Error ? error.message : "The server rejected the change.",
          }),
        );
        return;
      }
      drafts.setModelSelection(threadRef, plan.modelSelection, { explicit: true });
      if (plan.keptProvider) {
        toastManager.add(
          stackedThreadToast({
            type: "info",
            title: `Switched to ${plan.modelSelection.model}`,
            description: `This thread started on another provider, so it keeps that provider and uses ${company.name}'s model.`,
          }),
        );
      }
    },
    [updateThreadMetadata],
  );

  return { focusPane, closePane, openTarget, applyCompanyAgent };
}
