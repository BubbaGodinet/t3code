import {
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type ModelSelection,
  type OrchestrationSession,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { planCompanyAgentForThread } from "./companyAgent";

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
    ).toEqual({ kind: "switch", modelSelection: agent, keptProvider: false });
  });

  it("switches model on a started thread within the same provider", () => {
    const agent = { instanceId: codex, model: "gpt-5.4-mini" };
    expect(
      planCompanyAgentForThread({
        companyAgent: agent,
        thread: thread({ instanceId: codex, model: "gpt-5.4" }, session(codex, "codex")),
        providers,
      }),
    ).toEqual({ kind: "switch", modelSelection: agent, keptProvider: false });
  });

  it("keeps a started thread's provider and borrows the company's model when offered", () => {
    expect(
      planCompanyAgentForThread({
        companyAgent: { instanceId: claude, model: "gpt-5.4-mini" },
        thread: thread({ instanceId: codex, model: "gpt-5.4" }, session(codex, "codex")),
        providers,
      }),
    ).toEqual({
      kind: "switch",
      modelSelection: { instanceId: codex, model: "gpt-5.4-mini" },
      keptProvider: true,
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
