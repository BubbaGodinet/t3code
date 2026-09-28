import type { ModelSelection, ServerProvider } from "@t3tools/contracts";

import {
  getStartedThreadModelChangeBlockReason,
  threadShellHasStarted,
} from "../../components/ChatView.logic";
import type { ThreadShell } from "../../types";

export type CompanyAgentPlan =
  | { readonly kind: "unchanged" }
  | {
      readonly kind: "switch";
      readonly modelSelection: ModelSelection;
      /** The company's model, kept on the thread's own provider because that provider is locked. */
      readonly keptProvider: boolean;
    }
  | { readonly kind: "blocked"; readonly title: string; readonly description: string };

type PlanProvider = Pick<
  ServerProvider,
  "instanceId" | "driver" | "displayName" | "continuation" | "requiresNewThreadForModelChange"
> & { readonly models: ReadonlyArray<{ readonly slug: string }> };

function providerLabel(provider: PlanProvider | undefined, fallback: string): string {
  return provider?.displayName ?? provider?.driver ?? fallback;
}

/**
 * How assigning a company moves an existing thread onto the company's agent,
 * under the same rules as T3's model picker: an unstarted thread takes any
 * agent; a started one stays on its provider driver (and resume group), so it
 * switches model there, borrowing the company's model slug when that provider
 * offers it.
 */
export function planCompanyAgentForThread(input: {
  readonly companyAgent: ModelSelection;
  readonly thread: Pick<
    ThreadShell,
    "modelSelection" | "session" | "latestTurn" | "latestUserMessageAt"
  >;
  readonly providers: ReadonlyArray<PlanProvider>;
}): CompanyAgentPlan {
  const { companyAgent, thread, providers } = input;
  const currentInstanceId = thread.session?.providerInstanceId ?? thread.modelSelection.instanceId;
  const isCurrent = (selection: ModelSelection) =>
    selection.instanceId === currentInstanceId && selection.model === thread.modelSelection.model;
  if (isCurrent(companyAgent)) return { kind: "unchanged" };
  if (!threadShellHasStarted(thread)) {
    return { kind: "switch", modelSelection: companyAgent, keptProvider: false };
  }

  const current = providers.find((provider) => provider.instanceId === currentInstanceId);
  const next = providers.find((provider) => provider.instanceId === companyAgent.instanceId);
  const currentDriver = current?.driver ?? thread.session?.providerName ?? null;
  const sameResumeGroup =
    !current?.continuation ||
    !next?.continuation ||
    current.continuation.groupKey === next.continuation.groupKey;

  let candidate: ModelSelection | null = null;
  let keptProvider = false;
  if (next !== undefined && next.driver === currentDriver && sameResumeGroup) {
    candidate = companyAgent;
  } else if (current?.models.some((model) => model.slug === companyAgent.model)) {
    candidate = { instanceId: currentInstanceId, model: companyAgent.model };
    keptProvider = true;
  }
  const currentLabel = providerLabel(current, currentDriver ?? String(currentInstanceId));
  if (candidate === null) {
    return {
      kind: "blocked",
      title: `This thread stays on ${currentLabel}`,
      description: `T3 cannot move a started thread to ${providerLabel(next, String(companyAgent.instanceId))}. New chats in this company use it.`,
    };
  }
  if (isCurrent(candidate)) return { kind: "unchanged" };
  const blockReason = getStartedThreadModelChangeBlockReason({
    providers,
    hasStartedSession: thread.session !== null,
    currentModelSelection: thread.modelSelection,
    currentProviderInstanceId: thread.session?.providerInstanceId ?? null,
    nextModelSelection: candidate,
  });
  if (blockReason) return { kind: "blocked", ...blockReason };
  return { kind: "switch", modelSelection: candidate, keptProvider };
}
