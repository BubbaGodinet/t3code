import {
  deriveAgentPanelModel,
  emptyAgentPanelModel,
  type RuntimeSubagent,
} from "@t3tools/client-runtime/state/subagentRuntime";
import { TurnId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  agentMatchingReference,
  answerTitle,
  chatOutputTitle,
  chatOutputsSignature,
  deriveChatAgents,
  deriveChatOutputs,
  formatAgentFollowUp,
  formatEditedFiles,
  isInlineAgentReference,
  mergeChatOutputs,
  outputPreviewText,
  outputRowPreview,
  stepAgentStackIndex,
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
        transcript: "",
        events: [],
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
      ["explorer", "working", "Reading routes"],
      ["main", "stopped", null],
      ["reviewer", "done", null],
    ]);
  });

  it("keeps background tasks running while the parent turn is still active", () => {
    const task = (id: string, description: string, prompt: string) => ({
      kind: "tool.completed",
      createdAt: "2026-10-01T15:23:45.000Z",
      payload: {
        status: "completed",
        title: `Task: ${description}`,
        data: {
          toolCallId: id,
          kind: "other",
          rawInput: { _toolName: "task", description, prompt },
          rawOutput: { durationMs: 42, isBackground: true },
        },
      },
    });
    const agents = deriveChatAgents({
      mainLabel: "claude-opus-5-5",
      isWorking: true,
      latestTurn: { turnId: turnOne, state: "running" },
      runningTurnId: turnOne,
      agentPanelModel: emptyAgentPanelModel(),
      workLogEntries: [],
      checkpoints: [],
      activities: [
        task("call-split", "Split cellular sync switches", "Edit apps/mobile/src/sync.ts"),
        task(
          "call-dsn",
          "Per-environment web Sentry DSN",
          "Wire the DSN in infra/scripts/deploy-web.sh",
        ),
        task(
          "call-deadline",
          "Gather deadline reopen + notify",
          "Read apps/mobile/src/deadline.ts",
        ),
        {
          kind: "tool.completed",
          createdAt: "2026-10-01T15:23:50.000Z",
          payload: {
            status: "completed",
            title: "Task: Stop RN-X work",
            data: {
              toolCallId: "call-stop",
              kind: "other",
              rawInput: { _toolName: "task", description: "Stop RN-X work", prompt: "Stop it" },
              rawOutput: {
                error:
                  "Sub-agent is currently running. You may send the follow-up message when it has completed.",
              },
            },
          },
        },
        {
          kind: "tool.completed",
          createdAt: "2026-10-01T15:23:40.000Z",
          payload: {
            status: "completed",
            title: "MCP: tool",
            data: {
              toolCallId: "call-mcp",
              kind: "other",
              rawInput: { _toolName: "mcp", name: "list_thread_pull_requests" },
            },
          },
        },
      ],
    });

    const working = agents.filter((agent) => agent.state === "working" && agent.id !== "main");
    expect(working.map((agent) => agent.name)).toEqual([
      "Split cellular sync switches",
      "Per-environment web Sentry DSN",
      "Gather deadline reopen + notify",
    ]);
    expect(working.map((agent) => agent.detail)).toEqual([
      "Edit apps/mobile/src/sync.ts",
      "Wire the DSN in infra/scripts/deploy-web.sh",
      "Read apps/mobile/src/deadline.ts",
    ]);
    expect(agents.find((agent) => agent.id === "main")?.state).toBe("working");
    expect(
      agents.some((agent) => agent.name === "Stop RN-X work" && agent.state === "working"),
    ).toBe(false);
    expect(agents.some((agent) => agent.id === "call-mcp")).toBe(false);
    expect(agents.find((agent) => agent.id === "call-split")?.transcript).toContain(
      "Edit apps/mobile/src/sync.ts",
    );
  });

  it("marks a background launch Done once the parent turn has finished", () => {
    const agents = deriveChatAgents({
      mainLabel: "claude-opus-5-5",
      isWorking: false,
      latestTurn: { turnId: turnOne, state: "completed" },
      runningTurnId: null,
      agentPanelModel: emptyAgentPanelModel(),
      workLogEntries: [],
      checkpoints: [],
      activities: [
        {
          kind: "tool.completed",
          createdAt: "2026-10-01T15:23:45.000Z",
          payload: {
            status: "completed",
            title: "Task: Gather deadline reopen + notify",
            toolCallId: "toolu_deadline",
            data: { toolCallId: "toolu_deadline", kind: "other" },
          },
        },
      ],
    });
    expect(agents.map((agent) => [agent.name, agent.state])).toEqual([
      ["claude-opus-5-5", "done"],
      ["Gather deadline reopen + notify", "done"],
    ]);
    expect(agents.filter((agent) => agent.state === "working")).toEqual([]);
  });

  it("hides untitled Subagent task failures and does not count settled tasks as running", () => {
    const task = (id: string, title: string, rawOutput: Record<string, unknown>) => ({
      kind: "tool.completed",
      createdAt: "2026-09-30T18:25:05.000Z",
      payload: {
        status: "completed",
        title,
        toolCallId: id,
        data: {
          toolCallId: id,
          rawInput: {
            _toolName: "task",
            ...(title.startsWith("Task: Subagent")
              ? {}
              : { description: title.replace(/^Task:\s*/, "") }),
          },
          rawOutput,
        },
      },
    });
    const agents = deriveChatAgents({
      mainLabel: "default",
      isWorking: false,
      latestTurn: { turnId: turnOne, state: "completed", completedAt: "2026-09-30T18:25:18.000Z" },
      runningTurnId: null,
      agentPanelModel: emptyAgentPanelModel(),
      workLogEntries: [],
      checkpoints: [],
      activities: [
        task("toolu_a", "Task: Subagent task", {
          error: "Tool call arguments were not valid JSON",
        }),
        task("toolu_b", "Task: Subagent task", {
          error: "Tool call arguments were not valid JSON",
        }),
        task("toolu_studio", "Task: Map Studio config & schemas", { isBackground: true }),
        task("toolu_actions", "Task: Map actions, plugins, workflow", { isBackground: true }),
      ],
    });
    expect(agents.some((agent) => agent.name === "Subagent task")).toBe(false);
    expect(agents.filter((agent) => agent.state === "working")).toEqual([]);
    expect(agents.map((agent) => [agent.name, agent.state])).toEqual([
      ["default", "done"],
      ["Map Studio config & schemas", "done"],
      ["Map actions, plugins, workflow", "done"],
    ]);
  });

  it("keeps a child running when an in-progress event is newer than the parent completion", () => {
    const agents = deriveChatAgents({
      mainLabel: "default",
      isWorking: false,
      latestTurn: { turnId: turnOne, state: "completed", completedAt: "2026-09-30T18:25:18.000Z" },
      runningTurnId: null,
      agentPanelModel: emptyAgentPanelModel(),
      workLogEntries: [],
      checkpoints: [],
      activities: [
        {
          kind: "tool.completed",
          createdAt: "2026-09-30T18:25:05.000Z",
          payload: {
            status: "completed",
            title: "Task: Map Studio config & schemas",
            data: {
              toolCallId: "toolu_studio",
              rawInput: { _toolName: "task", description: "Map Studio config & schemas" },
              rawOutput: { isBackground: true },
            },
          },
        },
        {
          kind: "tool.updated",
          createdAt: "2026-09-30T18:26:00.000Z",
          payload: {
            status: "inProgress",
            title: "Read sanity.config.ts",
            agentId: "toolu_studio",
            data: { toolCallId: "toolu_read", command: "cat sanity.config.ts" },
          },
        },
      ],
    });
    const studio = agents.find((agent) => agent.name === "Map Studio config & schemas");
    expect(studio?.state).toBe("working");
    expect(studio?.events.map((event) => event.label)).toContain("Read sanity.config.ts");
    expect(agents.filter((agent) => agent.state === "working").map((agent) => agent.name)).toEqual([
      "Map Studio config & schemas",
    ]);
  });

  it("lists agents the parent says are running when no tool row survived", () => {
    const agents = deriveChatAgents({
      mainLabel: "claude-opus-5-5",
      isWorking: false,
      latestTurn: { turnId: turnTwo, state: "completed" },
      runningTurnId: null,
      agentPanelModel: emptyAgentPanelModel(),
      workLogEntries: [],
      checkpoints: [],
      messages: [
        {
          role: "assistant",
          turnId: turnOne,
          text: [
            "I've started three agents in parallel. Each works in its own copy:",
            "",
            "- **[Gather deadline reopen + notify](fd73c894-125f-4d01-b5cb-53c1f4bbf325):** saving a gather with a future deadline reopens it.",
            "- **[Split cellular sync switches](a8c59019-54ad-4f35-91e5-200da3f5deca):** the daily import of new photos runs on mobile data.",
            "- **[Per-environment web Sentry DSN](85e20f09-7767-4dc2-8022-a036216b7d5f):** the web deploy takes the right Sentry address.",
            "- [Docs](https://example.com/docs)",
          ].join("\n"),
        },
        {
          role: "assistant",
          turnId: turnTwo,
          text: [
            "They already are. Each change has its own agent, all three started two minutes ago and are running at the same time:",
            "",
            "- [Gather deadline reopen + notify](fd73c894-125f-4d01-b5cb-53c1f4bbf325)",
            "- [Split cellular sync switches](a8c59019-54ad-4f35-91e5-200da3f5deca)",
            "- [Per-environment web Sentry DSN](85e20f09-7767-4dc2-8022-a036216b7d5f)",
          ].join("\n"),
        },
      ],
    });

    expect(agents.filter((agent) => agent.state === "working")).toEqual([]);
    expect(agents.filter((agent) => agent.id !== "main").map((agent) => agent.name)).toEqual([
      "Gather deadline reopen + notify",
      "Split cellular sync switches",
      "Per-environment web Sentry DSN",
    ]);
    expect(agents.filter((agent) => agent.id !== "main").map((agent) => agent.id)).toEqual([
      "fd73c894-125f-4d01-b5cb-53c1f4bbf325",
      "a8c59019-54ad-4f35-91e5-200da3f5deca",
      "85e20f09-7767-4dc2-8022-a036216b7d5f",
    ]);
    expect(agents.find((agent) => agent.id === "main")?.state).toBe("done");
    expect(agents.some((agent) => agent.name === "Docs")).toBe(false);
    expect(
      agents.find((agent) => agent.name === "Gather deadline reopen + notify")?.transcript,
    ).toContain("future deadline");
  });

  it("does not duplicate a named agent that already has a tool row", () => {
    const agents = deriveChatAgents({
      mainLabel: "claude-opus-5-5",
      isWorking: false,
      latestTurn: { turnId: turnOne, state: "completed" },
      runningTurnId: null,
      agentPanelModel: emptyAgentPanelModel(),
      workLogEntries: [],
      checkpoints: [],
      messages: [
        {
          role: "assistant",
          turnId: turnOne,
          text: "Each change has its own agent and they are running:\n\n- [Split cellular sync switches](a8c59019-54ad-4f35-91e5-200da3f5deca)",
        },
      ],
      activities: [
        {
          kind: "tool.completed",
          createdAt: "2026-10-01T15:23:45.000Z",
          payload: {
            status: "completed",
            title: "Task: Split cellular sync switches",
            data: {
              toolCallId: "call-split",
              rawInput: {
                _toolName: "task",
                description: "Split cellular sync switches",
                prompt: "Edit apps/mobile/src/sync.ts",
              },
              rawOutput: { isBackground: true },
            },
          },
        },
      ],
    });
    expect(agents.filter((agent) => agent.name === "Split cellular sync switches")).toHaveLength(1);
    expect(agents.find((agent) => agent.name === "Split cellular sync switches")).toMatchObject({
      id: "call-split",
      state: "done",
    });
  });
});

describe("agent links", () => {
  it("treats a bare agent id as an in-app reference, not a route", () => {
    expect(isInlineAgentReference("fd73c894-125f-4d01-b5cb-53c1f4bbf325")).toBe(true);
    expect(isInlineAgentReference("toolu_01R8Yk4BSaTkTpce5ooUgyRt")).toBe(true);
    expect(isInlineAgentReference("https://example.com/docs")).toBe(false);
    expect(isInlineAgentReference("/threads/one")).toBe(false);
    expect(isInlineAgentReference("#section")).toBe(false);
    expect(
      agentMatchingReference(
        [
          {
            id: "fd73c894-125f-4d01-b5cb-53c1f4bbf325",
            name: "Gather deadline reopen + notify",
            state: "working",
            detail: null,
            files: [],
            transcript: "",
            events: [],
          },
        ],
        { label: "Gather deadline reopen + notify" },
      )?.id,
    ).toBe("fd73c894-125f-4d01-b5cb-53c1f4bbf325");
  });
});

describe("agent stack", () => {
  it("wraps the focused card with the arrow keys", () => {
    expect(stepAgentStackIndex(0, 3, -1)).toBe(2);
    expect(stepAgentStackIndex(2, 3, 1)).toBe(0);
    expect(stepAgentStackIndex(1, 3, 1)).toBe(2);
    expect(stepAgentStackIndex(1, 3, -1)).toBe(0);
  });

  it("addresses a subagent follow-up on the parent thread", () => {
    expect(
      formatAgentFollowUp(
        { id: "call-dsn", name: "Per-environment web Sentry DSN" },
        "Also cover staging",
      ),
    ).toEqual({
      text: 'Follow up for subagent "Per-environment web Sentry DSN" (call-dsn):\n\nAlso cover staging',
      viaParentThread: true,
    });
    expect(
      formatAgentFollowUp({ id: "main", name: "claude-opus-5-5" }, "Continue").viaParentThread,
    ).toBe(false);
  });
});

describe("chat outputs", () => {
  const base = {
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
        title: "First half.",
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

  it("replaces a stored model-name title when the answer is derived again", () => {
    const [output] = deriveChatOutputs({
      ...base,
      messages: [assistant("m1", turnOne, "2026-01-01T00:00:02Z", "Answer one")],
      unsettledTurnId: null,
      latestTurn: { turnId: turnOne, state: "completed" },
      checkpoints: [],
    });
    const stale = { ...output!, title: "default" };
    expect(mergeChatOutputs([stale], [output!])[0]?.title).toBe("Answer one");
    expect(chatOutputsSignature([stale])).not.toBe(chatOutputsSignature([output!]));
  });

  it("renames a kept output from its saved answer when that turn is no longer loaded", () => {
    const kept = {
      id: "turn:turn-1",
      kind: "turn" as const,
      turnId: turnOne,
      title: "default",
      text: "I'll pull up PR #1201's description and diff. The diff is a script.",
      files: [],
      outcome: "done" as const,
      completedAt: "2026-01-01T00:00:02Z",
    };
    expect(chatOutputTitle(kept)).toBe("I'll pull up PR #1201's description and diff.");
    expect(mergeChatOutputs([kept], [])[0]?.title).toBe(
      "I'll pull up PR #1201's description and diff.",
    );
  });
});

describe("answerTitle", () => {
  it("uses the first markdown heading, not the opening sentence", () => {
    expect(answerTitle("# Author Sync\n\nA pipeline that copies authors.")).toBe("Author Sync");
    expect(answerTitle("Intro line.\n\n## Architecture\n\nDetails.")).toBe("Architecture");
    expect(answerTitle("## `parser` **fix**\n\nDone.")).toBe("parser fix");
  });

  it("ignores a heading that only appears inside a code fence", () => {
    expect(answerTitle("```md\n# Not a title\n```\n\nThe real answer starts here.")).toBe(
      "The real answer starts here.",
    );
  });

  it("uses the first sentence when the answer has no heading", () => {
    expect(answerTitle("I'll pull up PR #1201's description and diff. The diff is a script.")).toBe(
      "I'll pull up PR #1201's description and diff.",
    );
    expect(answerTitle("Shipped in 1.2 today. More later.")).toBe("Shipped in 1.2 today.");
  });

  it("shortens a long first sentence", () => {
    const title = answerTitle(`${"word ".repeat(40)}end.`);
    expect(title?.endsWith("…")).toBe(true);
    expect(title!.length).toBeLessThanOrEqual(80);
  });
});

describe("outputPreviewText", () => {
  it("reads markdown as plain prose and skips code", () => {
    expect(
      outputPreviewText(
        "## Summary\n\n- Fixed **the** `parser`\n- See [docs](https://x.dev)\n\n```ts\nconst a = 1;\n```\nDone.",
      ),
    ).toBe("Summary Fixed the parser See docs Done.");
  });

  it("drops a repeated title from the row preview", () => {
    expect(
      outputRowPreview(
        "I'll pull up PR #1201's description and diff. The diff is a script.",
        "I'll pull up PR #1201's description and diff.",
      ),
    ).toBe("The diff is a script.");
    expect(outputRowPreview("# Author Sync\n\nA complete ETL pipeline.", "Author Sync")).toBe(
      "A complete ETL pipeline.",
    );
  });

  it("clips long answers", () => {
    const preview = outputPreviewText("word ".repeat(200));
    expect(preview.length).toBeLessThanOrEqual(281);
    expect(preview.endsWith("…")).toBe(true);
  });
});
