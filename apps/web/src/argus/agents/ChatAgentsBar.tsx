import type { ScopedThreadRef } from "@t3tools/contracts";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { memo, useCallback, useEffect, useState } from "react";

import ChatMarkdown from "../../components/ChatMarkdown";
import { composerFloatingLayerProps } from "../../components/chat/composerEventScope";
import {
  Dialog,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../../components/ui/dialog";
import { isContextMenuOpen } from "../../contextMenuFallback";
import { cn } from "../../lib/utils";
import { formatShortTimestamp } from "../../timestampFormat";
import {
  formatEditedFiles,
  outputPreviewText,
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
 * transcript and the kept outputs. Floats in the composer overlay just above
 * the composer, so the timeline reserves room for it and scrolls beneath it.
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
      className="pointer-events-none flex min-w-0 items-end gap-2 pb-1.5 text-xs"
    >
      {agents.length > 0 ? (
        <div className="surface-glass pointer-events-auto flex min-w-0 items-start gap-2 rounded-lg border border-border/60 px-2 py-1 shadow-sm">
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
        </div>
      ) : null}
      <div
        role="tablist"
        aria-label="Chat view"
        className="surface-glass pointer-events-auto ms-auto flex h-7 shrink-0 items-center rounded-lg border border-border/60 p-0.5 shadow-sm"
      >
        {(["transcript", "outputs"] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="tab"
            aria-selected={view === option}
            className={cn(
              "h-full rounded-md px-2 leading-none",
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

function OutputFiles({
  output,
  onOpenFile,
}: {
  output: ChatOutput;
  onOpenFile: (output: ChatOutput, path: string) => void;
}) {
  return (
    <ul className="flex flex-col gap-0.5 font-mono text-xs">
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
  );
}

function OutputMeta({
  output,
  timestampFormat,
}: {
  output: ChatOutput;
  timestampFormat: TimestampFormat;
}) {
  return (
    <>
      <AgentDot state={OUTCOME_STATE[output.outcome]} />
      <span className="truncate font-medium">{output.title}</span>
      {output.kind === "subagent" ? <span className="text-muted-foreground">subagent</span> : null}
      <span className="ms-auto shrink-0 text-muted-foreground">
        {STATE_LABEL[OUTCOME_STATE[output.outcome]]} ·{" "}
        {formatShortTimestamp(output.completedAt, timestampFormat)}
      </span>
    </>
  );
}

/** One finished output in full, over a darkened and blurred window. */
function ChatOutputDialog({
  output,
  cwd,
  threadRef,
  timestampFormat,
  onOpenFile,
  onClose,
}: {
  output: ChatOutput;
  cwd: string | undefined;
  threadRef: ScopedThreadRef | undefined;
  timestampFormat: TimestampFormat;
  onOpenFile: (output: ChatOutput, path: string) => void;
  onClose: () => void;
}) {
  // Claims Escape before the chat's own shortcuts can read it.
  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || isContextMenuOpen()) return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onEscape, { capture: true });
    return () => window.removeEventListener("keydown", onEscape, { capture: true });
  }, [onClose]);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup
        {...composerFloatingLayerProps}
        bottomStickOnMobile={false}
        backdropClassName="z-[60] bg-black/50! backdrop-blur-md!"
        viewportClassName="z-[60] px-4 py-6"
        className="max-h-[88vh] max-w-4xl"
      >
        <DialogHeader className="gap-1 pe-12 pb-3">
          <DialogTitle className="sr-only">{output.title} output</DialogTitle>
          <div className="flex min-w-0 items-center gap-1.5 text-xs">
            <OutputMeta output={output} timestampFormat={timestampFormat} />
          </div>
        </DialogHeader>
        <DialogPanel className="flex flex-col gap-4 pt-0">
          {output.text ? <ChatMarkdown text={output.text} cwd={cwd} threadRef={threadRef} /> : null}
          {output.files.length > 0 ? (
            <div className="flex flex-col gap-1.5 border-t pt-3">
              <span className="text-xs font-medium text-muted-foreground">
                {output.files.length === 1
                  ? "1 file edited"
                  : `${output.files.length} files edited`}
              </span>
              <OutputFiles
                output={output}
                onOpenFile={(target, path) => {
                  onClose();
                  onOpenFile(target, path);
                }}
              />
            </div>
          ) : null}
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}

/** Every finished output of the chat, newest first; an entry opens in full. */
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
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const focused = focusedId === null ? null : outputs.find((output) => output.id === focusedId);
  const closeFocused = useCallback(() => setFocusedId(null), []);
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
      className="flex h-full flex-col gap-2 overflow-y-auto p-4"
      style={{ paddingBottom: bottomInset + 16 }}
    >
      {outputs.map((output) => {
        const preview = outputPreviewText(output.text);
        const edited = formatEditedFiles(output.files.map((file) => file.path));
        return (
          <button
            key={output.id}
            type="button"
            aria-haspopup="dialog"
            className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-1.5 rounded-lg border bg-card p-3 text-left hover:border-foreground/20 hover:bg-accent/40"
            onClick={() => setFocusedId(output.id)}
          >
            <span className="flex w-full min-w-0 items-center gap-1.5 text-xs">
              <OutputMeta output={output} timestampFormat={timestampFormat} />
            </span>
            {preview ? (
              <span className="line-clamp-3 text-sm text-foreground/85">{preview}</span>
            ) : null}
            {edited ? (
              <span className="truncate text-xs text-muted-foreground">{edited}</span>
            ) : null}
          </button>
        );
      })}
      {focused ? (
        <ChatOutputDialog
          output={focused}
          cwd={cwd}
          threadRef={threadRef}
          timestampFormat={timestampFormat}
          onOpenFile={onOpenFile}
          onClose={closeFocused}
        />
      ) : null}
    </div>
  );
});
