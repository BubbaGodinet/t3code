import type { TimestampFormat } from "@t3tools/contracts/settings";
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";
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
  chatOutputTitle,
  formatEditedFiles,
  outputRowPreview,
  stepAgentStackIndex,
  type ChatAgentState,
  type ChatAgentStatus,
  type ChatOutput,
} from "./chatAgents";
import { FocusMarkdown, SCAN_TITLE_CLASS } from "./FocusMarkdown";

export type ChatSurfaceView = "transcript" | "outputs" | "docs";

const STATE_LABEL: Record<ChatAgentState, string> = {
  working: "Running",
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

function AgentLine({
  agent,
  onOpen,
}: {
  agent: ChatAgentStatus;
  onOpen: (agentId: string) => void;
}) {
  const edited = formatEditedFiles(agent.files);
  const detail =
    agent.detail ?? edited ?? (agent.state === "working" ? null : STATE_LABEL[agent.state]);
  return (
    <button
      type="button"
      className="flex min-w-0 items-center gap-1.5 rounded px-0.5 text-left hover:bg-accent/70"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onOpen(agent.id);
      }}
    >
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
    </button>
  );
}

const COMPACT_AGENT_LIMIT = 2;

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
  // Working rows stay visible. A finished parent must not be the only chip
  // while other agents are still running.
  const compact =
    workingCount > 0
      ? agents.filter((agent) => agent.state === "working")
      : agents.slice(0, COMPACT_AGENT_LIMIT);
  const shown = listOpen ? agents : compact;
  const overflow = agents.length - compact.length;
  const openStack = (agentId: string | null) => {
    if (agents.length === 0) return;
    const focus =
      agentId ?? agents.find((agent) => agent.state === "working")?.id ?? agents[0]?.id ?? null;
    setStackFocusId(focus);
  };
  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ href?: string; label?: string }>).detail;
      const agent = agentMatchingReference(agents, detail ?? {});
      const focus =
        agent?.id ?? agents.find((entry) => entry.state === "working")?.id ?? agents[0]?.id ?? null;
      if (focus) setStackFocusId(focus);
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
        <div className="surface-glass pointer-events-auto flex min-w-0 items-start gap-2 rounded-lg border border-border/60 px-2 py-1 shadow-sm">
          <div
            className={cn(
              "flex min-w-0 flex-1 gap-x-3 gap-y-0.5",
              listOpen ? "flex-col" : "flex-row items-center overflow-hidden",
            )}
          >
            <button
              type="button"
              className="shrink-0 font-medium text-muted-foreground hover:text-foreground"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                openStack(null);
              }}
            >
              Agents{workingCount > 0 ? ` · ${workingCount} running` : ""}
            </button>
            {shown.map((agent) => (
              <AgentLine key={agent.id} agent={agent} onOpen={openStack} />
            ))}
          </div>
          {overflow > 0 ? (
            <button
              type="button"
              aria-expanded={listOpen}
              className="flex h-5 shrink-0 items-center gap-0.5 rounded px-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={() => setListOpen((open) => !open)}
            >
              {listOpen ? <ChevronUpIcon className="size-3" /> : `+${overflow}`}
              {listOpen ? null : <ChevronDownIcon className="size-3" />}
            </button>
          ) : null}
        </div>
      ) : null}
      {stackFocusId !== null ? (
        <AgentStack
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

const PEEK_LIMIT = 4;
const PEEK_X = 14;
const PEEK_Y = 12;

function AgentStack({
  agents,
  focusId,
  onFocus,
  onClose,
  onFollowUp,
}: {
  agents: ReadonlyArray<ChatAgentStatus>;
  focusId: string;
  onFocus: (agentId: string) => void;
  onClose: () => void;
  onFollowUp?: (agent: ChatAgentStatus, text: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const index = Math.max(
    0,
    agents.findIndex((agent) => agent.id === focusId),
  );
  const count = agents.length;
  const front = agents[index] ?? agents[0];
  useEffect(() => {
    if (!front) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isContextMenuOpen()) return;
      const target = event.target;
      if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      if (count < 2) return;
      event.preventDefault();
      const next = stepAgentStackIndex(index, count, event.key === "ArrowRight" ? 1 : -1);
      const agent = agents[next];
      if (agent) onFocus(agent.id);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [agents, count, front, index, onFocus]);
  if (!front) return null;
  const depths: Array<{ agent: ChatAgentStatus; depth: number }> = [];
  const peekCount = Math.min(count - 1, PEEK_LIMIT);
  for (let depth = peekCount; depth >= 1; depth -= 1) {
    const agent = agents[stepAgentStackIndex(index, count, -depth)];
    if (agent) depths.push({ agent, depth });
  }
  const delivery = front.id === "main" ? "Sends in this chat." : `Sends to ${front.name}.`;
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
        showCloseButton
        variant="media"
        backdropClassName="z-[60] bg-black/60! backdrop-blur-md!"
        viewportClassName="z-[60] px-4 py-8"
        className="w-full max-w-4xl border-0 bg-transparent p-0 shadow-none"
      >
        <div
          className="relative"
          style={{ marginTop: peekCount * PEEK_Y, marginRight: peekCount * PEEK_X }}
        >
          {depths.map(({ agent, depth }) => (
            <button
              key={agent.id}
              type="button"
              aria-label={agent.name}
              className="argus-focus-doc absolute inset-x-0 top-0 h-16 rounded-2xl border border-[#d4d4d8] shadow-md"
              style={{
                transform: `translate(${depth * PEEK_X}px, ${-depth * PEEK_Y}px)`,
                zIndex: 10 - depth,
              }}
              onClick={() => onFocus(agent.id)}
            />
          ))}
          <article
            aria-label={front.name}
            className="argus-focus-doc relative z-10 flex max-h-[88vh] flex-col overflow-hidden rounded-2xl border border-[#d4d4d8] shadow-lg"
            onClickCapture={(event) => {
              const target = event.target;
              if (!(target instanceof Element)) return;
              const link = target.closest("[data-agent-ref]");
              if (!(link instanceof HTMLElement)) return;
              event.preventDefault();
              event.stopPropagation();
              const href = link.dataset.agentRef ?? "";
              const label = link.textContent?.trim() ?? "";
              const agent = agentMatchingReference(agents, { href, label });
              if (agent) onFocus(agent.id);
            }}
          >
            <header className="flex items-start gap-2 pe-12 pb-3 ps-6 pt-6">
              <div className="min-w-0 flex-1">
                <h2 className={SCAN_TITLE_CLASS}>{front.name}</h2>
                <div className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-[#3f3f46]">
                  <AgentDot state={front.state} />
                  <span>{STATE_LABEL[front.state]}</span>
                  {front.detail ? <span className="min-w-0 truncate">{front.detail}</span> : null}
                  {count > 1 ? (
                    <span className="ms-auto shrink-0">Left and right to switch</span>
                  ) : null}
                </div>
              </div>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-4">
              {front.transcript ? (
                <FocusMarkdown text={front.transcript} />
              ) : (
                <p className="text-sm text-[#3f3f46]">No output yet.</p>
              )}
            </div>
            {onFollowUp ? (
              <form
                className="flex flex-col gap-2 border-t border-[#d4d4d8] px-6 py-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  const text = draft.trim();
                  if (!text) return;
                  onFollowUp(front, text);
                  setDraft("");
                }}
              >
                <p className="text-xs text-[#3f3f46]">{delivery}</p>
                <textarea
                  value={draft}
                  rows={3}
                  placeholder={`Message ${front.name}`}
                  className="w-full resize-none rounded-lg border border-[#d4d4d8] bg-white px-3 py-2 text-sm text-[#0a0a0a] outline-none"
                  onChange={(event) => setDraft(event.target.value)}
                />
                <button
                  type="submit"
                  className="self-end rounded-md bg-[#18181b] px-3 py-1.5 text-sm text-white disabled:opacity-40"
                  disabled={draft.trim().length === 0}
                >
                  Send
                </button>
              </form>
            ) : null}
          </article>
        </div>
      </DialogPopup>
    </Dialog>
  );
}

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

/** One output or doc in full: a light, high-contrast sheet over a darkened, blurred window. */
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
        className="argus-focus-doc max-h-[88vh] max-w-4xl"
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
