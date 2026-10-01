import { describe, expect, it } from "vite-plus/test";
import { admitSubagentSessionUpdate } from "effect-acp/subagentSessionUpdate";

import {
  absorbCursorChildLink,
  cursorSubagentTaskDraft,
  emptyCursorChildSessions,
  projectCursorChildUpdate,
} from "./CursorSubagents.ts";

describe("admitSubagentSessionUpdate", () => {
  it("turns a Cursor subagent spawn into a tool call the ACP schema can decode", () => {
    expect(
      admitSubagentSessionUpdate({
        sessionId: "parent",
        update: {
          sessionUpdate: "subagent_spawned",
          subagentSessionId: "child-1",
          name: "explore",
          task: "Read the deploy script",
          _meta: { cursor: { toolCallId: "call-1", agentId: "child-1", model: "claude-opus-5-5" } },
        },
      }),
    ).toMatchObject({
      sessionId: "parent",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "call-1",
        status: "in_progress",
        rawInput: {
          _toolName: "subagent",
          subagentSessionId: "child-1",
          linkedToolCallId: "call-1",
          description: "Read the deploy script",
        },
      },
    });
  });
});

describe("Cursor child sessions", () => {
  it("keeps a background task working and appends the child transcript onto that tool", () => {
    const launched = cursorSubagentTaskDraft({
      toolCallId: "call-1\nfc_suffix",
      title: "Task: Per-environment web Sentry DSN",
      status: "completed",
      data: {
        rawInput: {
          _toolName: "task",
          description: "Per-environment web Sentry DSN",
          prompt: "Wire the DSN",
        },
        rawOutput: { isBackground: true, durationMs: 40 },
      },
    });
    expect(launched).toMatchObject({
      taskId: "call-1",
      phase: "working",
      title: "Per-environment web Sentry DSN",
    });

    const linked = absorbCursorChildLink(emptyCursorChildSessions(), {
      toolCallId: "call-1",
      rawInput: { _toolName: "subagent", subagentSessionId: "child-1", linkedToolCallId: "call-1" },
    });
    const projected = projectCursorChildUpdate(linked, "child-1", {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "Reading deploy-web.sh" },
    });
    expect(projected?.toolCallId).toBe("call-1");
    expect(projected?.transcript).toBe("Reading deploy-web.sh");
    expect(
      projectCursorChildUpdate(linked, "someone-else", { sessionUpdate: "agent_message_chunk" }),
    ).toBe(null);
  });
});
