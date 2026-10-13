import type { TimestampFormat } from "@t3tools/contracts/settings";
import { ChevronUpIcon } from "lucide-react";
import { memo, useEffect, useRef, useState, type ReactNode } from "react";

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
  OPEN_AGENT_EVENT,
  agentMatchingReference,
  agentIdentity,
  chatOutputTitle,
  formatEditedFiles,
  outputRowPreview,
  type ChatAgentState,
  type ChatAgentStatus,
  type ChatOutput,
} from "./chatAgents";
import { AgentChatBoard } from "./AgentChatBoard";
import { FocusMarkdown, SCAN_TITLE_CLASS } from "./FocusMarkdown";

export type ChatSurfaceView = "transcript" | "outputs" | "docs";

const STATE_LABEL: Record<ChatAgentState, string> = {
  working: "Running",
  idle: "Needs you",
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
        state === "working" && "bg-blue-500 ring-2 ring-blue-500/25",
        state === "idle" && "bg-yellow-400 ring-2 ring-yellow-400/25",
        (state === "done" || state === "stopped") && "bg-emerald-500",
        state === "failed" && "bg-red-500",
      )}
    />
  );
}

function AgentListRow({
  agent,
  onOpen,
}: {
  agent: ChatAgentStatus;
  onOpen: (agentId: string) => void;
}) {
  return (
    <button
      type="button"
      className="flex w-full min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-accent/70"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onOpen(agent.id);
      }}
    >
      <AgentDot state={agent.state} />
      <span
        className={cn(
          "min-w-0 flex-1 truncate",
          agent.state === "working" ? "text-foreground" : "text-foreground/75",
        )}
      >
        {agentIdentity(agent).title}
        {agentIdentity(agent).model ? (
          <span className="text-muted-foreground"> · {agentIdentity(agent).model}</span>
        ) : null}
      </span>
      <span className="shrink-0 text-muted-foreground">{STATE_LABEL[agent.state]}</span>
    </button>
  );
}

/**
 * The chat's agents, working ones marked live, and the Transcript / Outputs /
 * Docs chips. Floats in the composer overlay just above the composer, so the
 * timeline reserves room for it and scrolls beneath it. Choosing the open
 * list's chip again returns to the transcript.
 */
export const ChatAgentsBar = memo(function ChatAgentsBar({
  agents,
  outputCount,
  docsAvailable,
  view,
  onViewChange,
  onFollowUp,
}: {
  agents: ReadonlyArray<ChatAgentStatus>;
  outputCount: number;
  docsAvailable: boolean;
  view: ChatSurfaceView;
  onViewChange: (view: ChatSurfaceView) => void;
  onFollowUp?: (agent: ChatAgentStatus, text: string) => void;
}) {
  const [listOpen, setListOpen] = useState(false);
  const [stackFocusId, setStackFocusId] = useState<string | null>(null);
  const workingCount = agents.filter((agent) => agent.state === "working").length;
  const listed = agents.filter((agent) => agent.state === "working" || agent.state === "idle");
  const done = agents.filter((agent) => agent.state === "done" || agent.state === "stopped");
  const failed = agents.filter((agent) => agent.state === "failed");
  const [doneOpen, setDoneOpen] = useState(false);
  const [failedOpen, setFailedOpen] = useState(false);
  const openStack = (agentId: string) => {
    setListOpen(false);
    setStackFocusId(agentId);
  };
  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ href?: string; label?: string }>).detail;
      const agent = agentMatchingReference(agents, detail ?? {});
      const focus =
        agent?.id ?? agents.find((entry) => entry.state === "working")?.id ?? agents[0]?.id ?? null;
      if (!focus) return;
      setListOpen(false);
      setStackFocusId(focus);
    };
    window.addEventListener(OPEN_AGENT_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_AGENT_EVENT, onOpen);
  }, [agents]);
  const options: ReadonlyArray<ChatSurfaceView> = docsAvailable
    ? ["transcript", "outputs", "docs"]
    : ["transcript", "outputs"];
  return (
    <div
      data-chat-agents-bar
      className="pointer-events-none flex min-w-0 items-end gap-2 pb-1.5 text-xs"
    >
      {agents.length > 0 ? (
        <div
          className={cn(
            "surface-glass pointer-events-auto flex min-w-0 flex-col rounded-lg border border-border/60 px-2 py-1 shadow-sm",
            listOpen && "max-h-80 w-96 overflow-y-auto",
          )}
        >
          <button
            type="button"
            aria-expanded={listOpen}
            className="flex items-center gap-1.5 font-medium text-muted-foreground hover:text-foreground"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setListOpen((open) => !open);
            }}
          >
            {workingCount > 0 ? <AgentDot state="working" /> : null}
            <span className="min-w-0 flex-1 truncate text-left">
              Agents{workingCount > 0 ? ` · ${workingCount} running` : ""}
            </span>
            {listOpen ? <ChevronUpIcon className="size-3 shrink-0" /> : null}
          </button>
          {listOpen ? (
            <>
              {listed.map((agent) => (
                <AgentListRow key={agent.id} agent={agent} onOpen={openStack} />
              ))}
              {done.length > 0 ? (
                <button
                  type="button"
                  className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-muted-foreground hover:bg-accent/70"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setDoneOpen((open) => !open);
                  }}
                >
                  <AgentDot state="done" />
                  <span className="min-w-0 flex-1 truncate">Done · {done.length}</span>
                  <span>{doneOpen ? "Hide" : "Show"}</span>
                </button>
              ) : null}
              {doneOpen
                ? done.map((agent) => (
                    <AgentListRow key={agent.id} agent={agent} onOpen={openStack} />
                  ))
                : null}
              {failed.length > 0 ? (
                <button
                  type="button"
                  className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-muted-foreground hover:bg-accent/70"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setFailedOpen((open) => !open);
                  }}
                >
                  <AgentDot state="failed" />
                  <span className="min-w-0 flex-1 truncate">Failed · {failed.length}</span>
                  <span>{failedOpen ? "Hide" : "Show"}</span>
                </button>
              ) : null}
              {failedOpen
                ? failed.map((agent) => (
                    <AgentListRow key={agent.id} agent={agent} onOpen={openStack} />
                  ))
                : null}
            </>
          ) : null}
        </div>
      ) : null}
      {stackFocusId !== null ? (
        <AgentChatBoard
          agents={agents}
          focusId={stackFocusId}
          onFocus={setStackFocusId}
          onClose={() => setStackFocusId(null)}
          {...(onFollowUp ? { onFollowUp } : {})}
        />
      ) : null}
      <div
        role="tablist"
        aria-label="Chat view"
        className="surface-glass pointer-events-auto ms-auto flex h-7 shrink-0 items-center rounded-lg border border-border/60 p-0.5 shadow-sm"
      >
        {options.map((option) => (
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
            onClick={() => onViewChange(option === view ? "transcript" : option)}
          >
            {option === "transcript"
              ? "Transcript"
              : option === "docs"
                ? "Docs"
                : `Outputs${outputCount > 0 ? ` ${outputCount}` : ""}`}
          </button>
        ))}
      </div>
    </div>
  );
});

/** Focus that belongs to a menu, dialog, or the composer keeps its own Escape. */
function escapeBelongsElsewhere(): boolean {
  const active = document.activeElement;
  if (!(active instanceof Element) || active.closest("[data-argus-focus-doc]")) return false;
  return (
    active.closest(
      '[data-chat-composer-form="true"], [role="dialog"], [role="menu"], [role="listbox"]',
    ) !== null
  );
}

/**
 * The Outputs or Docs list, floating over the transcript just above the chips.
 * The transcript stays mounted and full width beneath it. Escape, a press
 * anywhere outside the list and the chips, or closing an entry's focus modal
 * returns to the transcript.
 */
export function ChatSurfacePanel({
  label,
  bottomInset,
  onDismiss,
  children,
}: {
  label: string;
  /** Distance from the bottom of the timeline to the top of the chips. */
  bottomInset: number;
  onDismiss: () => void;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || isContextMenuOpen()) return;
      if (escapeBelongsElsewhere()) return;
      event.preventDefault();
      event.stopPropagation();
      onDismiss();
    };
    const onPointerDown = (event: PointerEvent) => {
      const panel = panelRef.current;
      const target = event.target;
      if (!panel || !(target instanceof Element) || panel.contains(target)) return;
      if (target.closest("[data-argus-focus-doc]")) return;
      const chatColumn = panel.closest('[data-chat-workspace-drop-target="true"]');
      const chips = target.closest("[data-chat-agents-bar]");
      if (chips && chatColumn?.contains(chips)) return;
      onDismiss();
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    document.addEventListener("pointerdown", onPointerDown, { capture: true });
    return () => {
      window.removeEventListener("keydown", onKeyDown, { capture: true });
      document.removeEventListener("pointerdown", onPointerDown, { capture: true });
    };
  }, [onDismiss]);

  return (
    <div
      className="pointer-events-none absolute inset-x-0 top-0 z-20 flex flex-col justify-end ps-[calc(env(safe-area-inset-left)+0.75rem)] pe-[calc(env(safe-area-inset-right)+0.75rem)] pt-3 sm:ps-[calc(env(safe-area-inset-left)+1.25rem)] sm:pe-[calc(env(safe-area-inset-right)+1.25rem)]"
      style={{ bottom: bottomInset }}
    >
      <section
        ref={panelRef}
        aria-label={label}
        className="pointer-events-auto mx-auto flex max-h-[min(100%,36rem)] min-h-0 w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border/70 bg-popover text-popover-foreground shadow-lg"
      >
        {children}
      </section>
    </div>
  );
}

/** One output or doc in full: a dark sheet over a darkened, blurred window. */
export function ChatFocusDialog({
  title,
  meta,
  onClose,
  children,
}: {
  title: string;
  meta: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup
        {...composerFloatingLayerProps}
        data-argus-focus-doc=""
        bottomStickOnMobile={false}
        backdropClassName="z-[60] bg-black/60! backdrop-blur-md!"
        viewportClassName="z-[60] px-4 py-6"
        className="argus-focus-doc max-h-[88vh] max-w-4xl bg-[#161615]! text-[#edede8]! shadow-none backdrop-blur-none!"
      >
        <DialogHeader className="gap-1 pe-12 pb-3">
          <DialogTitle className={SCAN_TITLE_CLASS}>{title}</DialogTitle>
          <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            {meta}
          </div>
        </DialogHeader>
        <DialogPanel className="flex flex-col gap-4 pt-0">{children}</DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}

export function ChatSurfaceHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border/70 px-3 py-2 text-xs">
      <span className="font-medium text-foreground">{title}</span>
      {children}
    </div>
  );
}

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
            <span className="shrink-0 text-emerald-700">+{file.additions}</span>
          ) : null}
          {file.deletions !== null ? (
            <span className="shrink-0 text-destructive">-{file.deletions}</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function outputWhen(output: ChatOutput, timestampFormat: TimestampFormat): string {
  const when = `${STATE_LABEL[OUTCOME_STATE[output.outcome]]} · ${formatShortTimestamp(output.completedAt, timestampFormat)}`;
  return output.kind === "subagent" ? `subagent · ${when}` : when;
}

/** Every finished output of the chat, newest first; an entry opens in the focus modal. */
export const ChatOutputsList = memo(function ChatOutputsList({
  outputs,
  timestampFormat,
  onOpenFile,
  onDismiss,
}: {
  outputs: ReadonlyArray<ChatOutput>;
  timestampFormat: TimestampFormat;
  onOpenFile: (output: ChatOutput, path: string) => void;
  onDismiss: () => void;
}) {
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const focused = focusedId === null ? null : outputs.find((output) => output.id === focusedId);
  const focusedTitle = focused ? chatOutputTitle(focused) : null;
  return (
    <>
      <ChatSurfaceHeader title="Outputs">
        <span className="text-muted-foreground">{outputs.length}</span>
      </ChatSurfaceHeader>
      {outputs.length === 0 ? (
        <p className="px-3 py-6 text-center text-sm text-muted-foreground">
          Finished agent outputs collect here.
        </p>
      ) : (
        <ul className="min-h-0 flex-1 divide-y divide-border/60 overflow-y-auto">
          {outputs.map((output) => {
            const title = chatOutputTitle(output);
            const preview = outputRowPreview(output.text, title);
            const edited = formatEditedFiles(output.files.map((file) => file.path));
            return (
              <li key={output.id}>
                <button
                  type="button"
                  aria-haspopup="dialog"
                  className="flex w-full min-w-0 items-start gap-2 px-3 py-3 text-left hover:bg-accent/60"
                  onClick={() => setFocusedId(output.id)}
                >
                  <span className="mt-1.5">
                    <AgentDot state={OUTCOME_STATE[output.outcome]} />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex min-w-0 items-start gap-3">
                      <span className={cn(SCAN_TITLE_CLASS, "line-clamp-2 min-w-0 flex-1")}>
                        {title}
                      </span>
                      <span className="shrink-0 pt-0.5 text-xs whitespace-nowrap text-muted-foreground">
                        {outputWhen(output, timestampFormat)}
                      </span>
                    </span>
                    {preview ? (
                      <span className="line-clamp-2 text-[0.8125rem] leading-5 text-muted-foreground">
                        {preview}
                      </span>
                    ) : null}
                    {edited && edited !== title ? (
                      <span className="truncate text-xs text-muted-foreground">{edited}</span>
                    ) : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {focused ? (
        <ChatFocusDialog
          title={focusedTitle ?? focused.title}
          meta={
            <>
              <AgentDot state={OUTCOME_STATE[focused.outcome]} />
              <span className="ms-auto shrink-0">{outputWhen(focused, timestampFormat)}</span>
            </>
          }
          onClose={onDismiss}
        >
          {focused.text ? <FocusMarkdown text={focused.text} /> : null}
          {focused.files.length > 0 ? (
            <div className="flex flex-col gap-1.5 border-t pt-3">
              <span className="text-xs font-medium text-muted-foreground">
                {focused.files.length === 1
                  ? "1 file edited"
                  : `${focused.files.length} files edited`}
              </span>
              <OutputFiles
                output={focused}
                onOpenFile={(target, path) => {
                  onDismiss();
                  onOpenFile(target, path);
                }}
              />
            </div>
          ) : null}
        </ChatFocusDialog>
      ) : null}
    </>
  );
});
