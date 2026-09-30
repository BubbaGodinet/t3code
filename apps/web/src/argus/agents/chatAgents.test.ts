import {
  deriveAgentPanelModel,
  emptyAgentPanelModel,
  type RuntimeSubagent,
} from "@t3tools/client-runtime/state/subagentRuntime";
import { TurnId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  deriveChatAgents,
  deriveChatOutputs,
  formatEditedFiles,
  mergeChatOutputs,
} from "./chatAgents";

const turnOne = TurnId.make("turn-1");
const turnTwo = TurnId.make("turn-2");

function subagent(overrides: Partial<RuntimeSubagent> & Pick<RuntimeSubagent, "id">) {
  return {
    kind: "subagent",
    title: overrides.id,
    role: null,
    model: null,
    effort: null,
    status: "running",
    activationCount: 1,
    usage: null,
    progress: null,
    lastToolName: null,
    result: null,
    error: null,
    outputFile: null,
    parentAgentId: null,
    agentIndex: null,
    phaseIndex: null,
    phaseTitle: null,
    attempt: null,
    workflowName: null,
    phases: [],
    runHandles: null,
    recentActivity: [],
    firstSeenAt: "2026-01-01T00:00:00Z",
    startedAt: "2026-01-01T00:00:00Z",
    completedAt: null,
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  } satisfies RuntimeSubagent;
}

function assistant(id: string, turnId: TurnId, at: string, text: string) {
  return { role: "assistant" as const, text, turnId, createdAt: at, updatedAt: at, id };
}

describe("deriveChatAgents", () => {
  it("shows a single-session provider as one agent with the files it is editing", () => {
    const agents = deriveChatAgents({
      mainLabel: "claude-opus",
      isWorking: true,
      latestTurn: { turnId: turnOne, state: "running" },
      runningTurnId: turnOne,
      agentPanelModel: emptyAgentPanelModel(),
      workLogEntries: [
        { turnId: turnOne, changedFiles: ["src/a.ts", "src/b.ts"] },
        { turnId: turnOne, changedFiles: ["src/a.ts"] },
        { turnId: turnTwo, changedFiles: ["src/other.ts"] },
      ],
      checkpoints: [],
    });

    expect(agents).toEqual([
      {
        id: "main",
        name: "claude-opus",
        state: "working",
        detail: null,
        files: ["src/a.ts", "src/b.ts"],
      },
    ]);
    expect(formatEditedFiles(agents[0]!.files)).toBe("Edited a.ts, b.ts");
  });

  it("lists reported subagents and tells working apart from finished", () => {
    const agents = deriveChatAgents({
      mainLabel: "codex",
      isWorking: false,
      latestTurn: { turnId: turnOne, state: "interrupted" },
      runningTurnId: null,
      agentPanelModel: deriveAgentPanelModel({
        agents: [
          subagent({ id: "explorer", progress: "Reading routes\nmore" }),
          subagent({ id: "reviewer", status: "completed", result: "LGTM" }),
        ],
      }),
      workLogEntries: [],
      checkpoints: [],
    });

    expect(agents.map((agent) => [agent.id, agent.state, agent.detail])).toEqual([
      ["main", "stopped", null],
      ["explorer", "working", "Reading routes"],
      ["reviewer", "done", null],
    ]);
  });
});

describe("chat outputs", () => {
  const base = {
    mainLabel: "claude-opus",
    agentPanelModel: emptyAgentPanelModel(),
    workLogEntries: [],
  };

  it("records an interrupted turn's full answer and its edited files", () => {
    const outputs = deriveChatOutputs({
      ...base,
      messages: [
        assistant("m1", turnOne, "2026-01-01T00:00:02Z", "First half."),
        assistant("m2", turnOne, "2026-01-01T00:00:04Z", "Second half."),
      ],
      unsettledTurnId: null,
      latestTurn: { turnId: turnOne, state: "interrupted" },
      checkpoints: [
        {
          turnId: turnOne,
          files: [{ path: "src/a.ts", kind: "modified", additions: 3, deletions: 1 }],
        },
      ],
    });

    expect(outputs).toEqual([
      {
        id: "turn:turn-1",
        kind: "turn",
        turnId: turnOne,
        title: "claude-opus",
        text: "First half.\n\nSecond half.",
        files: [{ path: "src/a.ts", additions: 3, deletions: 1 }],
        outcome: "stopped",
        completedAt: "2026-01-01T00:00:04Z",
      },
    ]);
  });

  it("leaves a running turn out until it finishes", () => {
    const outputs = deriveChatOutputs({
      ...base,
      messages: [assistant("m1", turnOne, "2026-01-01T00:00:02Z", "Still going")],
      unsettledTurnId: turnOne,
      latestTurn: { turnId: turnOne, state: "running" },
      checkpoints: [],
    });
    expect(outputs).toEqual([]);
  });

  it("keeps a finished output after later turns, newest first, even once it leaves the loaded window", () => {
    const first = deriveChatOutputs({
      ...base,
      messages: [assistant("m1", turnOne, "2026-01-01T00:00:02Z", "Answer one")],
      unsettledTurnId: null,
      latestTurn: { turnId: turnOne, state: "interrupted" },
      checkpoints: [],
    });
    // A later turn finished; the first turn's messages were paged out of the client.
    const second = deriveChatOutputs({
      ...base,
      messages: [assistant("m2", turnTwo, "2026-01-01T00:05:00Z", "Answer two")],
      unsettledTurnId: null,
      latestTurn: { turnId: turnTwo, state: "completed" },
      agentPanelModel: deriveAgentPanelModel({
        agents: [
          subagent({
            id: "reviewer",
            title: "Reviewer",
            status: "completed",
            result: "Full review report",
            completedAt: "2026-01-01T00:04:00Z",
          }),
        ],
      }),
      checkpoints: [],
    });

    const kept = mergeChatOutputs(mergeChatOutputs([], first), second);
    expect(kept.map((output) => [output.id, output.text, output.outcome])).toEqual([
      ["turn:turn-2", "Answer two", "done"],
      ["agent:reviewer", "Full review report", "done"],
      ["turn:turn-1", "Answer one", "stopped"],
    ]);

    // The first turn comes back into view once no longer the latest: its stop is not forgotten.
    const reloaded = deriveChatOutputs({
      ...base,
      messages: [assistant("m1", turnOne, "2026-01-01T00:00:02Z", "Answer one")],
      unsettledTurnId: null,
      latestTurn: { turnId: turnTwo, state: "completed" },
      checkpoints: [],
    });
    expect(
      mergeChatOutputs(kept, reloaded).find((output) => output.id === "turn:turn-1"),
    ).toMatchObject({ outcome: "stopped", text: "Answer one" });
  });
});
