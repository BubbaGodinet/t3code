import {
  PROVIDER_DISPLAY_NAMES,
  type ModelSelection,
  type ProviderDriverKind,
  type ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";

import {
  getStartedThreadModelChangeBlockReason,
  threadShellHasStarted,
} from "../../components/ChatView.logic";
import {
  deriveProviderInstanceEntries,
  getDefaultProviderInstanceModel,
  sortProviderInstanceEntries,
  type ProviderInstanceEntry,
} from "../../providerInstances";
import type { ThreadShell } from "../../types";

export type CompanyAgentPlan =
  | { readonly kind: "unchanged" }
  | {
      readonly kind: "switch";
      readonly modelSelection: ModelSelection;
      /**
       * Set when the thread keeps its own provider account because that account
       * is locked, and only borrows the company's model.
       */
      readonly notice: { readonly title: string; readonly description: string } | null;
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
 * How assigning a company moves an existing thread onto the company's agent
 * and account (its provider instance), under the same rules as T3's model
 * picker: an unstarted thread takes any account; a started one stays on its
 * provider driver and resume group, so a Claude account with another config
 * directory or a Codex account with another CODEX_HOME cannot take it over.
 * Then the thread keeps its account and borrows the company's model slug when
 * that account offers it.
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
    return { kind: "switch", modelSelection: companyAgent, notice: null };
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
  const stays = {
    title: `This thread stays on ${currentLabel}`,
    description: `ARGUS cannot move a started thread to ${providerLabel(next, String(companyAgent.instanceId))}. New chats in this company use it.`,
  };
  // Same model on a locked account still differs from the company's account, so say so.
  if (candidate === null || (keptProvider && isCurrent(candidate))) {
    return { kind: "blocked", ...stays };
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
  return {
    kind: "switch",
    modelSelection: candidate,
    notice: keptProvider
      ? { title: `Switched to ${candidate.model}`, description: stays.description }
      : null,
  };
}

/** Provider instances a company can run on: T3's configured, installed, enabled accounts. */
export function companyAccountEntries(
  providers: ReadonlyArray<ServerProvider>,
): ReadonlyArray<ProviderInstanceEntry> {
  return sortProviderInstanceEntries(deriveProviderInstanceEntries(providers)).filter(
    (entry) => entry.enabled && entry.installed && entry.isAvailable,
  );
}

export function driverLabel(driver: ProviderDriverKind): string {
  return PROVIDER_DISPLAY_NAMES[driver] ?? driver;
}

/** "Claude DoorDash · me@doordash.com", with the account T3's provider probe reported. */
export function companyAccountLabel(entry: ProviderInstanceEntry): string {
  const { auth } = entry.snapshot;
  const who =
    auth.status === "authenticated"
      ? (auth.email ?? auth.label ?? null)
      : auth.status === "unauthenticated"
        ? "signed out"
        : null;
  return who ? `${entry.displayName} · ${who}` : entry.displayName;
}

/** The account a company takes when its agent changes: a signed-in one first, defaults first. */
export function preferredCompanyAccount(
  entries: ReadonlyArray<ProviderInstanceEntry>,
  driver: ProviderDriverKind,
): ProviderInstanceEntry | undefined {
  const forDriver = entries.filter((entry) => entry.driverKind === driver);
  return forDriver.find((entry) => entry.snapshot.auth.status === "authenticated") ?? forDriver[0];
}

/**
 * The company's agent on another account. The model carries over when the new
 * account offers it, so switching DoorDash from Claude Personal to Claude
 * DoorDash keeps Opus; otherwise it takes the account's default model.
 */
export function selectCompanyAccount(
  providers: ReadonlyArray<ServerProvider>,
  current: ModelSelection | null,
  instanceId: ProviderInstanceId,
): ModelSelection | null {
  const account = providers.find((provider) => provider.instanceId === instanceId);
  if (current && account?.models.some((model) => model.slug === current.model)) {
    return { instanceId, model: current.model };
  }
  const model = getDefaultProviderInstanceModel(providers, instanceId);
  return model ? { instanceId, model } : null;
}
