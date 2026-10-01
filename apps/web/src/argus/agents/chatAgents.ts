import {
  isActiveSubagentStatus,
  type AgentPanelModel,
  type RuntimeSubagent,
} from "@t3tools/client-runtime/state/subagentRuntime";
import type { OrchestrationLatestTurn, TurnId } from "@t3tools/contracts";

import { basenameOfPath } from "../../pierre-icons";
import type { WorkLogEntry } from "../../session-logic";
import type { ChatMessage, TurnDiffSummary } from "../../types";

export type ChatAgentState = "working" | "idle" | "done" | "stopped" | "failed";

/** One row of a chat's agent indicator: the main turn or a subagent the provider reported. */
export interface ChatAgentStatus {
  readonly id: string;
  readonly name: string;
  readonly state: ChatAgentState;
  /** What a working agent is doing right now, when the provider says. */
  readonly detail: string | null;
  readonly files: ReadonlyArray<string>;
  /** Assignment plus whatever output the provider has stored so far. */
  readonly transcript: string;
}

/** A thread activity the agent reader can see. Tool rows carry Cursor's Task payload. */
export interface ChatAgentActivity {
  readonly kind: string;
  readonly createdAt?: string;
  readonly payload: unknown;
}

export interface ChatOutputFile {
  readonly path: string;
  readonly additions: number | null;
  readonly deletions: number | null;
}

/** The complete result of an agent that finished, kept for the chat. */
export interface ChatOutput {
  readonly id: string;
  readonly kind: "turn" | "subagent";
  readonly turnId: TurnId | null;
  readonly title: string;
  readonly text: string;
  readonly files: ReadonlyArray<ChatOutputFile>;
  readonly outcome: "done" | "stopped" | "failed";
  readonly completedAt: string;
}

type LatestTurn = Pick<OrchestrationLatestTurn, "turnId" | "state">;
type TurnFilesSource = {
  readonly workLogEntries: ReadonlyArray<Pick<WorkLogEntry, "turnId" | "changedFiles">>;
  readonly checkpoints: ReadonlyArray<Pick<TurnDiffSummary, "turnId" | "files">>;
};

function turnFiles(source: TurnFilesSource, turnId: string): ChatOutputFile[] {
  const checkpoint = source.checkpoints.find((summary) => summary.turnId === turnId);
  if (checkpoint && checkpoint.files.length > 0) {
    return checkpoint.files.map((file) => ({
      path: file.path,
      additions: file.additions,
      deletions: file.deletions,
    }));
  }
  const paths = new Set<string>();
  for (const entry of source.workLogEntries) {
    if (entry.turnId !== turnId) continue;
    for (const path of entry.changedFiles ?? []) paths.add(path);
  }
  return [...paths].map((path) => ({ path, additions: null, deletions: null }));
}

function subagentState(status: RuntimeSubagent["status"]): ChatAgentState {
  if (isActiveSubagentStatus(status)) return "working";
  if (status === "idle") return "idle";
  if (status === "completed") return "done";
  if (status === "failed") return "failed";
  return "stopped";
}

/** Every agent the provider reported, workflow members in place of their coordinator. */
function reportedSubagents(model: AgentPanelModel): RuntimeSubagent[] {
  const agents: RuntimeSubagent[] = [];
  for (const group of model.workflows) {
    const members = [...group.phases.flatMap((phase) => phase.members), ...group.unphasedMembers];
    agents.push(...(members.length > 0 ? members : [group.workflow]));
  }
  agents.push(...model.directAgents);
  return agents;
}

const STATE_RANK: Record<ChatAgentState, number> = {
  working: 0,
  idle: 1,
  failed: 2,
  stopped: 3,
  done: 4,
};

/** Working agents first. Order within a state stays as discovered. */
export function orderChatAgents(agents: ReadonlyArray<ChatAgentStatus>): ChatAgentStatus[] {
  return agents
    .map((agent, index) => ({ agent, index }))
    .sort(
      (left, right) =>
        STATE_RANK[left.agent.state] - STATE_RANK[right.agent.state] || left.index - right.index,
    )
    .map(({ agent }) => agent);
}

/** Move through a stack by `direction` cards. Both ends wrap. */
export function stepAgentStackIndex(index: number, count: number, direction: number): number {
  if (count <= 0) return 0;
  return (((index + direction) % count) + count) % count;
}

/**
 * A follow-up to a subagent goes out on this chat, addressed to that agent.
 * The parent turn is the only channel Cursor gives us.
 */
export function formatAgentFollowUp(
  agent: Pick<ChatAgentStatus, "id" | "name">,
  text: string,
): { readonly text: string; readonly viaParentThread: boolean } {
  const body = text.trim();
  if (agent.id === "main") return { text: body, viaParentThread: false };
  return {
    text: `Follow up for subagent "${agent.name}" (${agent.id}):\n\n${body}`,
    viaParentThread: true,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/** Cursor tool ids arrive as `call-…\\nfc_…`. The call id is the stable agent id. */
export function cursorAgentId(toolCallId: string): string {
  const first = toolCallId.split("\n")[0]?.trim() ?? "";
  return first || toolCallId.trim();
}

function assistantTranscript(
  messages: ReadonlyArray<Pick<ChatMessage, "role" | "text" | "turnId">> | undefined,
  turnId: string | null,
): string {
  if (!messages || turnId === null) return "";
  return messages
    .filter((message) => message.role === "assistant" && message.turnId === turnId)
    .map((message) => message.text.trim())
    .filter((text) => text.length > 0)
    .join("\n\n");
}

function subagentTranscript(agent: RuntimeSubagent): string {
  return [agent.progress, agent.result, agent.error]
    .map((part) => part?.trim() ?? "")
    .filter((part) => part.length > 0)
    .join("\n\n");
}

interface CursorTaskAccum {
  id: string;
  name: string;
  prompt: string;
  transcript: string;
  files: string[];
  state: ChatAgentState;
  detail: string | null;
}

function taskTitle(title: string | null, rawInput: Record<string, unknown> | null): string | null {
  const description =
    asText(rawInput?.description) ?? asText(rawInput?.task) ?? asText(rawInput?.name);
  if (description) return description;
  if (!title) return null;
  return title.replace(/^Task:\s*/i, "").trim() || null;
}

function isCursorAgentTool(
  rawInput: Record<string, unknown> | null,
  rawOutput: Record<string, unknown> | null,
  title: string | null,
): boolean {
  const toolName = asText(rawInput?._toolName)?.toLowerCase();
  if (toolName === "task" || toolName === "subagent") return true;
  return rawOutput?.isBackground === true && (title?.startsWith("Task:") ?? false);
}

function contentText(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const parts: string[] = [];
  for (const entry of value) {
    const record = asRecord(entry);
    const nested = asRecord(record?.content);
    const text = asText(nested?.text) ?? asText(record?.text);
    if (text) parts.push(text);
  }
  return parts.length > 0 ? parts.join("\n") : null;
}

function outputText(rawOutput: Record<string, unknown> | null): string | null {
  if (!rawOutput) return null;
  return (
    asText(rawOutput.transcript) ??
    asText(rawOutput.content) ??
    asText(rawOutput.result) ??
    contentText(rawOutput.content)
  );
}

function locationPaths(data: Record<string, unknown> | null): string[] {
  const locations = data?.locations;
  if (!Array.isArray(locations)) return [];
  const paths: string[] = [];
  for (const location of locations) {
    const path = asText(asRecord(location)?.path);
    if (path && !paths.includes(path)) paths.push(path);
  }
  return paths;
}

function clipLine(value: string): string {
  const line =
    value
      .split("\n")
      .find((entry) => entry.trim().length > 0)
      ?.trim() ?? value.trim();
  return line.length > 80 ? `${line.slice(0, 79)}…` : line;
}

function workingDetail(task: CursorTaskAccum): string | null {
  const file = task.files.at(-1);
  if (file) return basenameOfPath(file);
  const promptLine = task.prompt
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0 && line !== task.name && !line.startsWith("#"));
  if (promptLine) return clipLine(promptLine);
  const transcriptLine = task.transcript
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0 && line !== task.name && line !== task.prompt);
  if (transcriptLine) return clipLine(transcriptLine);
  return "Running";
}

/**
 * Cursor launches subagents as Task tools that complete at once with
 * `{ isBackground: true }`. The child keeps running after the parent turn
 * is done. Those rows are already stored; this is the reader for them.
 */
function cursorTaskAgents(
  activities: ReadonlyArray<ChatAgentActivity> | undefined,
): ChatAgentStatus[] {
  if (!activities || activities.length === 0) return [];
  const tasks = new Map<string, CursorTaskAccum>();
  const ordered = [...activities].sort((left, right) =>
    (left.createdAt ?? "") < (right.createdAt ?? "") ? -1 : 1,
  );
  for (const activity of ordered) {
    if (activity.kind !== "tool.updated" && activity.kind !== "tool.completed") continue;
    const payload = asRecord(activity.payload);
    const data = asRecord(payload?.data) ?? payload;
    const rawInput = asRecord(data?.rawInput);
    const rawOutput = asRecord(data?.rawOutput);
    const title = asText(payload?.title) ?? asText(data?.title);
    if (!isCursorAgentTool(rawInput, rawOutput, title)) continue;
    const rawId =
      asText(rawInput?.linkedToolCallId) ?? asText(data?.toolCallId) ?? asText(payload?.toolCallId);
    if (!rawId) continue;
    const id = cursorAgentId(rawId);
    const task = tasks.get(id) ?? {
      id,
      name: id,
      prompt: "",
      transcript: "",
      files: [],
      state: "working" as const,
      detail: null,
    };
    const name = taskTitle(title, rawInput);
    if (name && (task.name === task.id || name.length > task.name.length)) task.name = name;
    const prompt = asText(rawInput?.prompt);
    if (prompt && prompt.length > task.prompt.length) task.prompt = prompt;
    const written = outputText(rawOutput) ?? contentText(data?.content);
    if (written && written.length >= task.transcript.length) task.transcript = written;
    for (const path of locationPaths(data)) {
      if (!task.files.includes(path)) task.files.push(path);
    }
    const status = asText(payload?.status) ?? asText(data?.status);
    const childState = asText(rawInput?.state);
    const runningError =
      asText(rawOutput?.error)?.toLowerCase().includes("currently running") ?? false;
    const background = rawOutput?.isBackground === true;
    if (childState === "failed" || status === "failed") task.state = "failed";
    else if (childState === "cancelled" || childState === "disconnected") task.state = "stopped";
    else if (childState === "completed") task.state = "done";
    else if (background) task.state = "working";
    else if (runningError) task.state = "failed";
    else if (status === "completed") task.state = "done";
    else if (status === "in_progress" || status === "inProgress" || status === "pending") {
      task.state = "working";
    }
    tasks.set(id, task);
  }
  return [...tasks.values()].map((task) => {
    const transcript = [task.prompt, task.transcript]
      .filter((part, index, all) => part.length > 0 && all.indexOf(part) === index)
      .join("\n\n");
    return {
      id: task.id,
      name: task.name,
      state: task.state,
      detail: task.state === "working" ? workingDetail(task) : null,
      files: task.files,
      transcript,
    };
  });
}

function mergeAgent(current: ChatAgentStatus, incoming: ChatAgentStatus): ChatAgentStatus {
  const working = current.state === "working" || incoming.state === "working";
  return {
    id: current.id,
    name: current.name === current.id ? incoming.name : current.name,
    state: working ? "working" : current.state,
    detail: current.detail ?? incoming.detail,
    files: current.files.length > 0 ? current.files : incoming.files,
    transcript:
      incoming.transcript.length > current.transcript.length
        ? incoming.transcript
        : current.transcript,
  };
}

/**
 * The chat's agents: the main turn, provider-reported subagents, and Cursor
 * Task tools that are still in flight after their launch row says completed.
 * A provider with a single session yields a single row. Working agents sort first.
 */
export function deriveChatAgents(
  input: TurnFilesSource & {
    readonly mainLabel: string;
    readonly isWorking: boolean;
    readonly latestTurn: LatestTurn | null;
    readonly runningTurnId: TurnId | null;
    readonly agentPanelModel: AgentPanelModel;
    readonly messages?: ReadonlyArray<Pick<ChatMessage, "role" | "text" | "turnId">>;
    readonly activities?: ReadonlyArray<ChatAgentActivity>;
  },
): ChatAgentStatus[] {
  const agents: ChatAgentStatus[] = [];
  const turnId = input.runningTurnId ?? input.latestTurn?.turnId ?? null;
  if (turnId !== null || input.isWorking) {
    const settledState: ChatAgentState =
      input.latestTurn?.state === "interrupted"
        ? "stopped"
        : input.latestTurn?.state === "error"
          ? "failed"
          : "done";
    agents.push({
      id: "main",
      name: input.mainLabel,
      state: input.isWorking ? "working" : settledState,
      detail: null,
      files: turnId === null ? [] : turnFiles(input, turnId).map((file) => file.path),
      transcript: assistantTranscript(input.messages, turnId),
    });
  }
  const byId = new Map<string, ChatAgentStatus>();
  for (const agent of agents) byId.set(agent.id, agent);
  for (const agent of reportedSubagents(input.agentPanelModel)) {
    const state = subagentState(agent.status);
    const row: ChatAgentStatus = {
      id: agent.id,
      name: agent.title,
      state,
      detail:
        state === "working"
          ? ((agent.progress?.split("\n")[0]?.trim() || agent.lastToolName) ?? null)
          : null,
      files: [],
      transcript: subagentTranscript(agent),
    };
    const existing = byId.get(row.id);
    byId.set(row.id, existing ? mergeAgent(existing, row) : row);
  }
  for (const agent of cursorTaskAgents(input.activities)) {
    const existing = byId.get(agent.id);
    // The stored Task tool is the authority for Cursor children: a background
    // launch stays working after the parent turn is marked done.
    byId.set(
      agent.id,
      existing
        ? {
            ...mergeAgent(existing, agent),
            state: agent.state,
            detail: agent.detail ?? existing.detail,
          }
        : agent,
    );
  }
  return orderChatAgents([...byId.values()]);
}

const EDITED_FILES_SHOWN = 3;

/** "Edited a.ts, b.ts" the way Cursor names a turn's files, or null when none. */
export function formatEditedFiles(files: ReadonlyArray<string>): string | null {
  if (files.length === 0) return null;
  const names = files.slice(0, EDITED_FILES_SHOWN).map(basenameOfPath).join(", ");
  const rest = files.length - EDITED_FILES_SHOWN;
  return rest > 0 ? `Edited ${names} +${rest}` : `Edited ${names}`;
}

const OUTPUT_PREVIEW_CHARS = 280;
const ANSWER_TITLE_MAX = 80;

/** A plain-text glimpse of an output's markdown for its row in the Outputs list. */
export function outputPreviewText(text: string): string {
  const plain = plainAnswer(text);
  return plain.length > OUTPUT_PREVIEW_CHARS
    ? `${plain.slice(0, OUTPUT_PREVIEW_CHARS).trimEnd()}…`
    : plain;
}

/**
 * Title for one finished answer. The first markdown heading wins; otherwise
 * the first sentence, shortened so the row can be read at a glance. This is
 * never the model name.
 */
export function answerTitle(text: string): string | null {
  const source = text.replace(/```[\s\S]*?(```|$)/g, "\n").replace(/~~~[\s\S]*?(~~~|$)/g, "\n");
  const heading = firstAtxHeading(source);
  if (heading) return clipTitle(heading);
  const plain = plainAnswer(source);
  if (!plain) return null;
  return clipTitle(firstSentence(plain));
}

/** The list preview under a title, with that title not repeated at the start. */
export function outputRowPreview(text: string, title: string): string {
  const preview = outputPreviewText(text);
  const stem = title.replace(/…$/, "").trim();
  if (!stem || !preview.toLowerCase().startsWith(stem.toLowerCase())) return preview;
  return preview
    .slice(stem.length)
    .replace(/^[\s.!?…,:;–—-]+/, "")
    .trim();
}

function plainAnswer(text: string): string {
  return text
    .replace(/```[\s\S]*?(```|$)/g, " ")
    .replace(/~~~[\s\S]*?(~~~|$)/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/[*_`~]+/g, "")
    .replace(/<[^>\n]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function firstAtxHeading(source: string): string | null {
  const match = /^ {0,3}#{1,6}[ \t]+([^\n]*)$/m.exec(source);
  if (!match?.[1]) return null;
  const plain = match[1]
    .replace(/[ \t]+#+\s*$/, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`~]+/g, "")
    .replace(/<[^>\n]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return plain || null;
}

/** A period in "1.2" or "e.g. the" does not end the sentence. */
function firstSentence(plain: string): string {
  const match = /^.+?[.!?…](?=\s+[A-Z]|\s*$)/.exec(plain);
  return (match?.[0] ?? plain).trim();
}

function clipTitle(title: string): string {
  if (title.length <= ANSWER_TITLE_MAX) return title;
  const cut = title.slice(0, ANSWER_TITLE_MAX - 1);
  const space = cut.lastIndexOf(" ");
  const shortened = (space >= 32 ? cut.slice(0, space) : cut).trimEnd();
  return `${shortened}…`;
}

/**
 * The title to show for an output. A stored model name ("default") is ignored
 * so a kept answer still gets its heading or first sentence.
 */
export function chatOutputTitle(output: Pick<ChatOutput, "text" | "title" | "files">): string {
  const fromAnswer = answerTitle(output.text);
  if (fromAnswer) return fromAnswer;
  const stored = output.title.trim();
  if (stored && stored.toLowerCase() !== "default") return stored;
  return formatEditedFiles(output.files.map((file) => file.path)) ?? "Finished output";
}

function withChatOutputTitle(output: ChatOutput): ChatOutput {
  const title = chatOutputTitle(output);
  return title === output.title ? output : { ...output, title };
}

/**
 * Finished outputs derivable from what the client has loaded: every settled
 * turn's full answer and edited files, and every finished subagent's report.
 */
export function deriveChatOutputs(
  input: TurnFilesSource & {
    readonly messages: ReadonlyArray<
      Pick<ChatMessage, "role" | "text" | "turnId" | "createdAt" | "updatedAt">
    >;
    readonly unsettledTurnId: TurnId | null;
    readonly latestTurn: LatestTurn | null;
    readonly agentPanelModel: AgentPanelModel;
  },
): ChatOutput[] {
  const turns = new Map<TurnId, { texts: string[]; completedAt: string }>();
  for (const message of input.messages) {
    if (message.role !== "assistant" || !message.turnId) continue;
    if (message.turnId === input.unsettledTurnId) continue;
    const turn = turns.get(message.turnId) ?? { texts: [], completedAt: message.updatedAt };
    const text = message.text.trim();
    if (text.length > 0) turn.texts.push(text);
    if (message.updatedAt > turn.completedAt) turn.completedAt = message.updatedAt;
    turns.set(message.turnId, turn);
  }

  const outputs: ChatOutput[] = [];
  for (const [turnId, turn] of turns) {
    const files = turnFiles(input, turnId);
    if (turn.texts.length === 0 && files.length === 0) continue;
    const latestState = input.latestTurn?.turnId === turnId ? input.latestTurn.state : null;
    const text = turn.texts.join("\n\n");
    outputs.push({
      id: `turn:${turnId}`,
      kind: "turn",
      turnId,
      title: chatOutputTitle({ text, title: "", files }),
      text,
      files,
      outcome:
        latestState === "interrupted" ? "stopped" : latestState === "error" ? "failed" : "done",
      completedAt: turn.completedAt,
    });
  }

  for (const agent of reportedSubagents(input.agentPanelModel)) {
    const state = subagentState(agent.status);
    const text = (
      state === "failed" ? (agent.error ?? agent.result) : (agent.result ?? agent.error)
    )?.trim();
    if (state === "working" || !text) continue;
    outputs.push({
      id: `agent:${agent.id}`,
      kind: "subagent",
      turnId: null,
      title: chatOutputTitle({
        text,
        title: agent.title.trim().toLowerCase() === "default" ? "" : agent.title,
        files: [],
      }),
      text,
      files: [],
      outcome: state === "failed" ? "failed" : state === "stopped" ? "stopped" : "done",
      completedAt: agent.completedAt ?? agent.updatedAt,
    });
  }
  return outputs.toSorted(compareNewestFirst);
}

function compareNewestFirst(left: ChatOutput, right: ChatOutput): number {
  if (left.completedAt !== right.completedAt) {
    return left.completedAt < right.completedAt ? 1 : -1;
  }
  return left.id < right.id ? 1 : left.id > right.id ? -1 : 0;
}

/**
 * Folds newly derived outputs into the kept list, newest first. Nothing kept
 * is dropped when it leaves the loaded window, and a stop or failure stays
 * recorded after later turns stop reporting it.
 */
export function mergeChatOutputs(
  kept: ReadonlyArray<ChatOutput>,
  next: ReadonlyArray<ChatOutput>,
): ChatOutput[] {
  const byId = new Map(kept.map((output) => [output.id, withChatOutputTitle(output)]));
  for (const output of next) {
    const titled = withChatOutputTitle(output);
    const previous = byId.get(titled.id);
    byId.set(
      titled.id,
      previous && previous.outcome !== "done" && titled.outcome === "done"
        ? { ...titled, outcome: previous.outcome }
        : titled,
    );
  }
  return [...byId.values()].toSorted(compareNewestFirst);
}

/** Cheap identity for skipping writes when nothing about the outputs changed. */
export function chatOutputsSignature(outputs: ReadonlyArray<ChatOutput>): string {
  return outputs
    .map(
      (output) =>
        `${output.id}|${output.title.replaceAll("\n", " ")}|${output.outcome}|${output.completedAt}|${output.text.length}|${output.files.length}`,
    )
    .join("\n");
}
