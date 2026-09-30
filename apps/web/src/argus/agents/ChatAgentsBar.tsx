import type { ScopedThreadRef } from "@t3tools/contracts";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { memo, useState } from "react";

import ChatMarkdown from "../../components/ChatMarkdown";
import { cn } from "../../lib/utils";
import { formatShortTimestamp } from "../../timestampFormat";
import {
  formatEditedFiles,
  type ChatAgentState,
  type ChatAgentStatus,
  type ChatOutput,
} from "./chatAgents";

export type ChatSurfaceView = "transcript" | "outputs";

const STATE_LABEL: Record<ChatAgentState, string> = {
  working: "Working",
  idle: "Idle",
  done: "Done",
  stopped: "Stopped",
  failed: "Failed",
};

/** Static on purpose: a live dot must not repaint every frame. */
function AgentDot({ state }: { state: ChatAgentState }) {
  return (
    <span
      aria-hidden
      className={cn(
        "size-2 shrink-0 rounded-full",
        state === "working" && "bg-amber-500 ring-2 ring-amber-500/25",
        (state === "done" || state === "idle") && "bg-muted-foreground/35",
        state === "stopped" && "border border-muted-foreground/60",
        state === "failed" && "bg-destructive",
      )}
    />
  );
}

function AgentLine({ agent }: { agent: ChatAgentStatus }) {
  const edited = formatEditedFiles(agent.files);
  const detail =
    agent.detail ?? edited ?? (agent.state === "working" ? null : STATE_LABEL[agent.state]);
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <AgentDot state={agent.state} />
      <span
        className={cn(
          "max-w-40 shrink-0 truncate",
          agent.state === "working" ? "text-foreground" : "text-foreground/75",
        )}
      >
        {agent.name}
      </span>
      {detail ? <span className="min-w-0 truncate text-muted-foreground">{detail}</span> : null}
      <span className="sr-only">{STATE_LABEL[agent.state]}</span>
    </div>
  );
}

const COMPACT_AGENT_LIMIT = 2;

/**
 * The chat's agents, working ones marked live, with a switch between the
 * transcript and the kept outputs. Sits under the chat header in every pane.
 */
export const ChatAgentsBar = memo(function ChatAgentsBar({
  agents,
  outputCount,
  view,
  onViewChange,
}: {
  agents: ReadonlyArray<ChatAgentStatus>;
  outputCount: number;
  view: ChatSurfaceView;
  onViewChange: (view: ChatSurfaceView) => void;
}) {
  const [listOpen, setListOpen] = useState(false);
  const workingCount = agents.filter((agent) => agent.state === "working").length;
  const shown = listOpen ? agents : agents.slice(0, COMPACT_AGENT_LIMIT);
  const hiddenCount = agents.length - shown.length;
  return (
    <div
      data-chat-agents-bar
      className="flex shrink-0 items-start gap-2 border-b bg-background px-3 py-1 text-xs"
    >
      <div
        className={cn(
          "flex min-w-0 flex-1 gap-x-3 gap-y-0.5",
          listOpen ? "flex-col" : "flex-row items-center overflow-hidden",
        )}
      >
        <span className="shrink-0 font-medium text-muted-foreground">
          Agents{workingCount > 0 ? ` · ${workingCount} working` : ""}
        </span>
        {shown.map((agent) => (
          <AgentLine key={agent.id} agent={agent} />
        ))}
      </div>
      {agents.length > COMPACT_AGENT_LIMIT ? (
        <button
          type="button"
          aria-expanded={listOpen}
          className="flex h-5 shrink-0 items-center gap-0.5 rounded px-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={() => setListOpen((open) => !open)}
        >
          {listOpen ? <ChevronUpIcon className="size-3" /> : `+${hiddenCount}`}
          {listOpen ? null : <ChevronDownIcon className="size-3" />}
        </button>
      ) : null}
      <div
        role="tablist"
        aria-label="Chat view"
        className="flex h-5 shrink-0 items-center rounded-md border p-px"
      >
        {(["transcript", "outputs"] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="tab"
            aria-selected={view === option}
            className={cn(
              "h-full rounded-[5px] px-1.5 leading-none",
              view === option
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => onViewChange(option)}
          >
            {option === "transcript"
              ? "Transcript"
              : `Outputs${outputCount > 0 ? ` ${outputCount}` : ""}`}
          </button>
        ))}
      </div>
    </div>
  );
});

const OUTCOME_STATE: Record<ChatOutput["outcome"], ChatAgentState> = {
  done: "done",
  stopped: "stopped",
  failed: "failed",
};

/** Every finished output of the chat, newest first, each shown in full. */
export const ChatOutputsView = memo(function ChatOutputsView({
  outputs,
  cwd,
  threadRef,
  timestampFormat,
  bottomInset,
  onOpenFile,
}: {
  outputs: ReadonlyArray<ChatOutput>;
  cwd: string | undefined;
  threadRef: ScopedThreadRef | undefined;
  timestampFormat: TimestampFormat;
  /** Height of the composer docked over the bottom of the chat. */
  bottomInset: number;
  onOpenFile: (output: ChatOutput, path: string) => void;
}) {
  if (outputs.length === 0) {
    return (
      <div
        className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground"
        style={{ paddingBottom: bottomInset }}
      >
        Finished agent outputs collect here.
      </div>
    );
  }
  return (
    <div
      className="flex h-full flex-col gap-3 overflow-y-auto p-4"
      style={{ paddingBottom: bottomInset + 16 }}
    >
      {outputs.map((output) => (
        <article
          key={output.id}
          className="flex min-w-0 flex-col gap-2 rounded-lg border bg-card p-3"
        >
          <header className="flex min-w-0 items-center gap-1.5 text-xs">
            <AgentDot state={OUTCOME_STATE[output.outcome]} />
            <span className="truncate font-medium">{output.title}</span>
            {output.kind === "subagent" ? (
              <span className="text-muted-foreground">subagent</span>
            ) : null}
            <span className="ms-auto shrink-0 text-muted-foreground">
              {STATE_LABEL[OUTCOME_STATE[output.outcome]]} ·{" "}
              {formatShortTimestamp(output.completedAt, timestampFormat)}
            </span>
          </header>
          {output.text ? <ChatMarkdown text={output.text} cwd={cwd} threadRef={threadRef} /> : null}
          {output.files.length > 0 ? (
            <ul className="flex flex-col gap-0.5 border-t pt-2 font-mono text-xs">
              {output.files.map((file) => (
                <li key={file.path} className="flex min-w-0 items-center gap-2">
                  <button
                    type="button"
                    disabled={output.turnId === null}
                    className="min-w-0 truncate text-left hover:underline disabled:no-underline"
                    onClick={() => onOpenFile(output, file.path)}
                  >
                    {file.path}
                  </button>
                  {file.additions !== null ? (
                    <span className="shrink-0 text-emerald-600 dark:text-emerald-400">
                      +{file.additions}
                    </span>
                  ) : null}
                  {file.deletions !== null ? (
                    <span className="shrink-0 text-destructive">-{file.deletions}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </article>
      ))}
    </div>
  );
});
