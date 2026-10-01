/**
 * Cursor Task tools return immediately with `{ isBackground: true }` while the
 * child keeps running. Once the client advertises subagents, Cursor also sends
 * the child's session updates on a different session id. Those stay tied to
 * the launch tool instead of being dropped or flattened into the parent reply.
 */

export interface CursorChildSessions {
  readonly ids: ReadonlySet<string>;
  readonly toolCallIdBySession: ReadonlyMap<string, string>;
  readonly transcriptByTool: ReadonlyMap<string, string>;
}

export function emptyCursorChildSessions(): CursorChildSessions {
  return {
    ids: new Set(),
    toolCallIdBySession: new Map(),
    transcriptByTool: new Map(),
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

const TRANSCRIPT_LIMIT = 80_000;

export function absorbCursorChildLink(
  state: CursorChildSessions,
  update: unknown,
): CursorChildSessions {
  const record = asRecord(update);
  const rawInput = asRecord(record?.rawInput);
  const sessionId = asText(rawInput?.subagentSessionId);
  if (!sessionId) return state;
  const toolCallId = asText(rawInput?.linkedToolCallId) ?? asText(record?.toolCallId) ?? sessionId;
  if (state.ids.has(sessionId) && state.toolCallIdBySession.get(sessionId) === toolCallId) {
    return state;
  }
  const ids = new Set(state.ids);
  ids.add(sessionId);
  const toolCallIdBySession = new Map(state.toolCallIdBySession);
  toolCallIdBySession.set(sessionId, toolCallId);
  return { ...state, ids, toolCallIdBySession };
}

function chunkText(update: Record<string, unknown>): string | null {
  const sessionUpdate = update.sessionUpdate;
  if (sessionUpdate === "agent_message_chunk" || sessionUpdate === "agent_thought_chunk") {
    const content = asRecord(update.content);
    return content?.type === "text" ? asText(content.text) : null;
  }
  if (sessionUpdate === "tool_call" || sessionUpdate === "tool_call_update") {
    const title = asText(update.title);
    const rawOutput = asRecord(update.rawOutput);
    const output = asText(rawOutput?.transcript) ?? asText(rawOutput?.content);
    return [title, output].filter((part): part is string => part !== null).join("\n") || null;
  }
  return null;
}

export interface ProjectedCursorChild {
  readonly state: CursorChildSessions;
  readonly toolCallId: string;
  readonly title: string;
  readonly transcript: string;
}

/** Folds one child-session update into the launch tool's running transcript. */
export function projectCursorChildUpdate(
  state: CursorChildSessions,
  childSessionId: string,
  update: unknown,
): ProjectedCursorChild | null {
  if (!state.ids.has(childSessionId)) return null;
  const record = asRecord(update);
  if (!record) return null;
  const delta = chunkText(record);
  if (!delta) return null;
  const toolCallId = state.toolCallIdBySession.get(childSessionId) ?? childSessionId;
  const previous = state.transcriptByTool.get(toolCallId) ?? "";
  let transcript = previous.length > 0 ? `${previous}\n${delta}` : delta;
  if (transcript.length > TRANSCRIPT_LIMIT) {
    transcript = transcript.slice(transcript.length - TRANSCRIPT_LIMIT);
  }
  const transcriptByTool = new Map(state.transcriptByTool);
  transcriptByTool.set(toolCallId, transcript);
  const title = asText(record.title) ?? "Subagent";
  return {
    state: { ...state, transcriptByTool },
    toolCallId,
    title,
    transcript,
  };
}

export interface CursorSubagentTaskDraft {
  readonly taskId: string;
  readonly title: string;
  readonly phase: "working" | "done" | "failed" | "stopped";
  readonly summary: string | null;
}

/** The task event a Cursor Task / subagent tool call should project, if it is one. */
export function cursorSubagentTaskDraft(toolCall: {
  readonly toolCallId: string;
  readonly title?: string;
  readonly status?: string;
  readonly data: Record<string, unknown>;
}): CursorSubagentTaskDraft | null {
  const rawInput = asRecord(toolCall.data.rawInput);
  const rawOutput = asRecord(toolCall.data.rawOutput);
  const toolName = asText(rawInput?._toolName)?.toLowerCase();
  const title = asText(toolCall.title);
  const background = rawOutput?.isBackground === true;
  if (
    toolName !== "task" &&
    toolName !== "subagent" &&
    !(background && (title?.startsWith("Task:") ?? false))
  ) {
    return null;
  }
  const linked = asText(rawInput?.linkedToolCallId) ?? toolCall.toolCallId;
  const taskId = linked.split("\n")[0]?.trim() || linked.trim();
  if (!taskId) return null;
  const name =
    asText(rawInput?.description) ??
    asText(rawInput?.task) ??
    asText(rawInput?.name) ??
    (title ? title.replace(/^Task:\s*/i, "").trim() : null) ??
    "Subagent";
  const childState = asText(rawInput?.state);
  const summarySource = asText(rawOutput?.transcript) ?? asText(rawInput?.prompt);
  const summary = summarySource
    ? (
        summarySource
          .split("\n")
          .find((line) => line.trim().length > 0)
          ?.trim() ?? ""
      ).slice(0, 160)
    : null;
  if (childState === "failed" || toolCall.status === "failed") {
    return { taskId, title: name, phase: "failed", summary };
  }
  if (childState === "cancelled" || childState === "disconnected") {
    return { taskId, title: name, phase: "stopped", summary };
  }
  if (childState === "completed") {
    return { taskId, title: name, phase: "done", summary };
  }
  if (
    background ||
    toolCall.status === "in_progress" ||
    toolCall.status === "inProgress" ||
    toolCall.status === "pending" ||
    !toolCall.status
  ) {
    return { taskId, title: name, phase: "working", summary };
  }
  if (toolCall.status === "completed") {
    return { taskId, title: name, phase: "done", summary };
  }
  return { taskId, title: name, phase: "working", summary };
}
