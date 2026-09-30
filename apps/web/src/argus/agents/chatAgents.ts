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

/**
 * Finished outputs derivable from what the client has loaded: every settled
 * turn's full answer and edited files, and every finished subagent's report.
 */
export function deriveChatOutputs(
  input: TurnFilesSource & {
    readonly mainLabel: string;
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
    outputs.push({
      id: `turn:${turnId}`,
      kind: "turn",
      turnId,
      title: input.mainLabel,
      text: turn.texts.join("\n\n"),
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
      title: agent.title,
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
  const byId = new Map(kept.map((output) => [output.id, output]));
  for (const output of next) {
    const previous = byId.get(output.id);
    byId.set(
      output.id,
      previous && previous.outcome !== "done" && output.outcome === "done"
        ? { ...output, outcome: previous.outcome }
        : output,
    );
  }
  return [...byId.values()].toSorted(compareNewestFirst);
}

/** Cheap identity for skipping writes when nothing about the outputs changed. */
export function chatOutputsSignature(outputs: ReadonlyArray<ChatOutput>): string {
  return outputs
    .map(
      (output) =>
        `${output.id}|${output.outcome}|${output.completedAt}|${output.text.length}|${output.files.length}`,
    )
    .join("\n");
}
