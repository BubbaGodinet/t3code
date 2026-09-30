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

/**
 * The chat's agents as the provider reports them: the main turn plus any
 * subagents. A provider with a single session yields a single row.
 */
export function deriveChatAgents(
  input: TurnFilesSource & {
    readonly mainLabel: string;
    readonly isWorking: boolean;
    readonly latestTurn: LatestTurn | null;
    readonly runningTurnId: TurnId | null;
    readonly agentPanelModel: AgentPanelModel;
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
    });
  }
  for (const agent of reportedSubagents(input.agentPanelModel)) {
    const state = subagentState(agent.status);
    agents.push({
      id: agent.id,
      name: agent.title,
      state,
      detail:
        state === "working"
          ? ((agent.progress?.split("\n")[0]?.trim() || agent.lastToolName) ?? null)
          : null,
      files: [],
    });
  }
  return agents;
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
