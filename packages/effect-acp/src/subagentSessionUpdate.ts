/**
 * Cursor only publishes subagents when the client advertises the capability,
 * and it does so with session updates the stock ACP schema does not list
 * (`subagent_spawned`, `subagent_state_update`). A failed decode kills the
 * session stream, so these are admitted as ordinary tool calls first.
 */

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function cursorMeta(meta: unknown): {
  toolCallId: string | null;
  agentId: string | null;
  model: string | null;
} {
  const cursor = asRecord(asRecord(meta)?.cursor);
  return {
    toolCallId: asText(cursor?.toolCallId),
    agentId: asText(cursor?.agentId),
    model: asText(cursor?.model),
  };
}

function toolStatus(state: string | null): "in_progress" | "completed" | "failed" {
  if (state === "failed") return "failed";
  if (state === "completed" || state === "cancelled" || state === "disconnected")
    return "completed";
  return "in_progress";
}

/** Rewrites Cursor subagent session updates into tool calls the ACP schema accepts. */
export function admitSubagentSessionUpdate(payload: unknown): unknown {
  const notification = asRecord(payload);
  const update = asRecord(notification?.update);
  if (!notification || !update) return payload;
  const kind = update.sessionUpdate;
  if (kind !== "subagent_spawned" && kind !== "subagent_state_update") return payload;
  const sessionId = asText(update.subagentSessionId);
  if (!sessionId) return payload;
  const meta = cursorMeta(update._meta);
  const toolCallId = meta.toolCallId ?? sessionId;
  const name = asText(update.name);
  const task = asText(update.task);
  const state = asText(update.state);
  const rawInput: Record<string, unknown> = {
    _toolName: "subagent",
    subagentSessionId: sessionId,
    linkedToolCallId: toolCallId,
  };
  if (name) rawInput.name = name;
  if (task) {
    rawInput.task = task;
    rawInput.description = task;
  }
  if (meta.agentId) rawInput.agentId = meta.agentId;
  if (meta.model) rawInput.model = meta.model;
  if (state) rawInput.state = state;
  return {
    ...notification,
    update: {
      sessionUpdate: kind === "subagent_spawned" ? "tool_call" : "tool_call_update",
      toolCallId,
      title: task || name || "Subagent",
      kind: "other",
      status: kind === "subagent_spawned" ? "in_progress" : toolStatus(state),
      rawInput,
    },
  };
}
