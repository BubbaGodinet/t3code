import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  EnvironmentId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type ModelSelection,
  type OrchestrationSession,
  type ServerProvider,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { planCompanyAgentForThread, selectCompanyAccount } from "./companyAgent";
import { parseMosaicLayout, reconcileMosaicLayout, serializeMosaicLayout } from "./mosaicLayout";
import type { MosaicCompany } from "./mosaicStore";

const codex = ProviderInstanceId.make("codex");
const claude = ProviderInstanceId.make("claudeAgent");
const cursor = ProviderInstanceId.make("cursor");

const provider = (
  instanceId: ProviderInstanceId,
  driver: string,
  models: string[],
  extra: { requiresNewThreadForModelChange?: boolean } = {},
) => ({
  instanceId,
  driver: ProviderDriverKind.make(driver),
  displayName: driver,
  models: models.map((slug) => ({ slug })),
  ...extra,
});

const providers = [
  provider(codex, "codex", ["gpt-5.4", "gpt-5.4-mini"]),
  provider(claude, "claudeAgent", ["claude-opus-4-6"]),
  provider(cursor, "cursor", ["gpt-5.4", "claude-opus-4-6"], {
    requiresNewThreadForModelChange: true,
  }),
];

const session = (instanceId: ProviderInstanceId, providerName: string): OrchestrationSession => ({
  threadId: ThreadId.make("t1"),
  status: "ready",
  providerName,
  providerInstanceId: instanceId,
  runtimeMode: "full-access",
  activeTurnId: null,
  lastError: null,
  updatedAt: "2026-09-28T00:00:00.000Z",
});

function thread(modelSelection: ModelSelection, started: OrchestrationSession | null) {
  return {
    modelSelection,
    session: started,
    latestTurn: null,
    latestUserMessageAt: started ? "2026-09-28T00:00:00.000Z" : null,
  };
}

describe("planCompanyAgentForThread", () => {
  it("moves an unstarted thread to any provider", () => {
    const agent = { instanceId: claude, model: "claude-opus-4-6" };
    expect(
      planCompanyAgentForThread({
        companyAgent: agent,
        thread: thread({ instanceId: codex, model: "gpt-5.4" }, null),
        providers,
      }),
    ).toEqual({ kind: "switch", modelSelection: agent, notice: null });
  });

  it("switches model on a started thread within the same provider", () => {
    const agent = { instanceId: codex, model: "gpt-5.4-mini" };
    expect(
      planCompanyAgentForThread({
        companyAgent: agent,
        thread: thread({ instanceId: codex, model: "gpt-5.4" }, session(codex, "codex")),
        providers,
      }),
    ).toEqual({ kind: "switch", modelSelection: agent, notice: null });
  });

  it("keeps a started thread's provider and borrows the company's model when offered", () => {
    expect(
      planCompanyAgentForThread({
        companyAgent: { instanceId: claude, model: "gpt-5.4-mini" },
        thread: thread({ instanceId: codex, model: "gpt-5.4" }, session(codex, "codex")),
        providers,
      }),
    ).toMatchObject({
      kind: "switch",
      modelSelection: { instanceId: codex, model: "gpt-5.4-mini" },
      notice: { title: "Switched to gpt-5.4-mini" },
    });
  });

  it("explains when the started thread's provider cannot take the company's agent", () => {
    const plan = planCompanyAgentForThread({
      companyAgent: { instanceId: claude, model: "claude-opus-4-6" },
      thread: thread({ instanceId: codex, model: "gpt-5.4" }, session(codex, "codex")),
      providers,
    });
    expect(plan.kind).toBe("blocked");
  });

  it("respects providers that lock the model once a session starts", () => {
    const plan = planCompanyAgentForThread({
      companyAgent: { instanceId: cursor, model: "claude-opus-4-6" },
      thread: thread({ instanceId: cursor, model: "gpt-5.4" }, session(cursor, "cursor")),
      providers,
    });
    expect(plan).toMatchObject({ kind: "blocked", title: "Start a new chat to change models" });
  });

  it("does nothing when the thread already runs the company's agent", () => {
    expect(
      planCompanyAgentForThread({
        companyAgent: { instanceId: codex, model: "gpt-5.4" },
        thread: thread({ instanceId: codex, model: "gpt-5.4" }, session(codex, "codex")),
        providers,
      }),
    ).toEqual({ kind: "unchanged" });
  });
});

describe("company accounts", () => {
  const personal = ProviderInstanceId.make("claudeAgent");
  const doordash = ProviderInstanceId.make("claude_doordash");
  const codexWork = ProviderInstanceId.make("codex");
  const codexDoordash = ProviderInstanceId.make("codex_doordash");
  const account = (
    instanceId: ProviderInstanceId,
    driver: string,
    displayName: string,
    groupKey: string,
    models: string[],
  ) => ({
    ...provider(instanceId, driver, models),
    displayName,
    continuation: { groupKey },
  });
  // Claude accounts in separate config directories resume apart; Codex shadow homes share one.
  const accounts = [
    account(personal, "claudeAgent", "Claude", "claude:~/.claude", ["claude-opus-4-6"]),
    account(doordash, "claudeAgent", "Claude DoorDash", "claude:~/.claude_doordash", [
      "claude-opus-4-6",
      "claude-sonnet-4-6",
    ]),
    account(codexWork, "codex", "Codex", "codex:~/.codex", ["gpt-5.4"]),
    account(codexDoordash, "codex", "Codex DoorDash", "codex:~/.codex", ["gpt-5.4"]),
  ];

  it("starts an unstarted chat on the company's account", () => {
    const agent = { instanceId: doordash, model: "claude-opus-4-6" };
    expect(
      planCompanyAgentForThread({
        companyAgent: agent,
        thread: thread({ instanceId: personal, model: "claude-opus-4-6" }, null),
        providers: accounts,
      }),
    ).toEqual({ kind: "switch", modelSelection: agent, notice: null });
  });

  it("says a started thread stays on its Claude account even when the model matches", () => {
    expect(
      planCompanyAgentForThread({
        companyAgent: { instanceId: doordash, model: "claude-opus-4-6" },
        thread: thread(
          { instanceId: personal, model: "claude-opus-4-6" },
          session(personal, "claudeAgent"),
        ),
        providers: accounts,
      }),
    ).toEqual({
      kind: "blocked",
      title: "This thread stays on Claude",
      description:
        "ARGUS cannot move a started thread to Claude DoorDash. New chats in this company use it.",
    });
  });

  it("moves a started Codex thread between accounts that share a CODEX_HOME", () => {
    const agent = { instanceId: codexDoordash, model: "gpt-5.4" };
    expect(
      planCompanyAgentForThread({
        companyAgent: agent,
        thread: thread({ instanceId: codexWork, model: "gpt-5.4" }, session(codexWork, "codex")),
        providers: accounts,
      }),
    ).toEqual({ kind: "switch", modelSelection: agent, notice: null });
  });

  it("keeps the model when the company moves to an account that offers it", () => {
    expect(
      selectCompanyAccount(
        accounts as unknown as ServerProvider[],
        { instanceId: personal, model: "claude-opus-4-6" },
        doordash,
      ),
    ).toEqual({ instanceId: doordash, model: "claude-opus-4-6" });
  });

  it("saves the company's account with the layout and reads it back after a restart", () => {
    const company: MosaicCompany = {
      id: "doordash",
      name: "DoorDash",
      color: "#ef4444",
      projectRef: scopeProjectRef(EnvironmentId.make("env"), ProjectId.make("dd")),
      modelSelection: { instanceId: doordash, model: "claude-opus-4-6" },
    };
    const saved = serializeMosaicLayout({
      companies: [company],
      panes: {},
      root: null,
      floating: {},
      agents: {},
      savedAt: null,
      editedAt: "2026-09-28T23:00:00.000Z",
    });
    expect(JSON.parse(saved).companies[0].modelSelection.instanceId).toBe("claude_doordash");
    expect(parseMosaicLayout(saved)?.companies).toEqual([company]);
    const restarted = reconcileMosaicLayout(saved, {
      companies: [],
      panes: {},
      root: null,
      floating: {},
      agents: {},
      savedAt: null,
      editedAt: null,
    });
    expect(restarted).toMatchObject({ kind: "apply", layout: { companies: [company] } });
  });
});
