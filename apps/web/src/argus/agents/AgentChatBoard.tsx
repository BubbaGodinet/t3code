import { memo, useEffect, useMemo, useState } from "react";

import { Dialog, DialogPopup } from "../../components/ui/dialog";
import { composerFloatingLayerProps } from "../../components/chat/composerEventScope";
import { isContextMenuOpen } from "../../contextMenuFallback";
import {
  agentIdentity,
  stepAgentStackIndex,
  type ChatAgentEvent,
  type ChatAgentStatus,
} from "./chatAgents";
import "./agent-chat.css";

type BoardStatus = "running" | "waiting" | "failed" | "done";
type ToolKind = "GREP" | "READ" | "RUN" | "MCP";
type ToolFilter = "All" | ToolKind | "Errors";

function boardStatus(state: ChatAgentStatus["state"]): BoardStatus {
  if (state === "working") return "running";
  if (state === "failed") return "failed";
  if (state === "idle") return "waiting";
  return "done";
}

function statusLabel(status: BoardStatus): string {
  if (status === "running") return "Running";
  if (status === "waiting") return "Needs you";
  if (status === "failed") return "Failed";
  return "Done";
}

/** Blue is running, yellow needs you, red failed, green done. */
function statusPaint(status: BoardStatus): { fg: string; bg: string; line: string } {
  if (status === "running") {
    return { fg: "var(--blue)", bg: "var(--bluebg)", line: "var(--blueline)" };
  }
  if (status === "waiting") {
    return { fg: "var(--amber)", bg: "var(--amberbg)", line: "var(--amberline)" };
  }
  if (status === "failed") {
    return { fg: "var(--red)", bg: "var(--redbg)", line: "var(--redline)" };
  }
  return { fg: "var(--green)", bg: "var(--greenbg)", line: "var(--greenline)" };
}

function toolKind(label: string): ToolKind {
  const value = label.toLowerCase();
  if (value.includes("grep") || value.includes("search") || value.includes("glob")) return "GREP";
  if (value.includes("read") || value.includes("open")) return "READ";
  if (value.includes("mcp")) return "MCP";
  return "RUN";
}

function commandOf(event: ChatAgentEvent): string {
  return event.detail?.trim() || event.label;
}

function tagsFor(agents: ReadonlyArray<ChatAgentStatus>): Map<string, string> {
  const counts = new Map<string, number>();
  for (const agent of agents) {
    const key = agentIdentity(agent).title.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  const tags = new Map<string, string>();
  for (const agent of agents) {
    const key = agentIdentity(agent).title.toLowerCase();
    if ((counts.get(key) ?? 0) < 2) continue;
    const next = (seen.get(key) ?? 0) + 1;
    seen.set(key, next);
    tags.set(agent.id, `#${next}`);
  }
  return tags;
}

function looksLikePrompt(text: string): boolean {
  return /^you are working in\b/i.test(text.trim());
}

function outcomeText(agent: ChatAgentStatus, status: BoardStatus): string {
  if (status === "running" || status === "waiting") {
    const live =
      [...agent.events].reverse().find((event) => event.state === "working") ?? agent.events.at(-1);
    const command = live?.detail?.trim() || live?.label?.trim() || "";
    if (command && !looksLikePrompt(command) && !/^task:/i.test(command)) return command;
    if (agent.detail && !looksLikePrompt(agent.detail)) return agent.detail;
    return status === "waiting" ? "Waiting for you" : "Working";
  }
  const text = agent.transcript.trim();
  if (!text || looksLikePrompt(text) || text === agent.task) {
    return status === "failed" ? (agent.detail ?? "Failed") : "Finished";
  }
  if (status === "failed") return text.length > 500 ? `${text.slice(0, 500).trimEnd()}…` : text;
  const sentence = text.match(/^[\s\S]{1,500}?[.!?]/)?.[0];
  return sentence ?? (text.length > 500 ? `${text.slice(0, 500).trimEnd()}…` : text);
}

const KIND_COLOR: Record<ToolKind, string> = {
  GREP: "var(--blue)",
  READ: "var(--ink2)",
  RUN: "var(--amber)",
  MCP: "var(--green)",
};

function StatusMark({ status }: { status: BoardStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5" style={{ color: statusPaint(status).fg }}>
      <span
        aria-hidden
        className="inline-block size-2 rounded-full"
        style={{ background: "currentColor" }}
      />
      <span className="font-sans text-xs font-semibold">{statusLabel(status)}</span>
    </span>
  );
}

function CallRows({
  agent,
  events,
  newestFirst,
  expanded,
  onToggle,
}: {
  agent: ChatAgentStatus;
  events: ReadonlyArray<ChatAgentEvent>;
  newestFirst: boolean;
  expanded: Readonly<Record<string, boolean>>;
  onToggle: (key: string) => void;
}) {
  const rows = newestFirst ? [...events].reverse() : events;
  return (
    <>
      {rows.map((event, index) => {
        const key = `${agent.id}:${event.id}`;
        const open = expanded[key] === true;
        const kind = toolKind(event.label);
        const failed = event.state === "failed";
        const running = event.state === "working";
        return (
          <div key={event.id}>
            <button
              type="button"
              className="grid w-full items-start gap-2.5 border-b px-4 py-2.5 text-left"
              style={{
                gridTemplateColumns: newestFirst ? "44px 1fr 40px" : "30px 48px minmax(0,1fr) 44px",
                borderColor: "var(--line)",
                background: failed ? "var(--redbg)" : running ? "var(--bluebg)" : "transparent",
                paddingInline: newestFirst ? 18 : 16,
              }}
              onClick={() => onToggle(key)}
            >
              {newestFirst ? null : (
                <span className="text-right font-mono text-xs" style={{ color: "var(--ink3)" }}>
                  {index + 1}
                </span>
              )}
              <span
                className="font-mono text-[11px] font-semibold tracking-wide"
                style={{
                  color: failed ? "var(--red)" : KIND_COLOR[kind],
                  width: newestFirst ? 44 : undefined,
                }}
              >
                {kind}
              </span>
              <span className="min-w-0 font-mono text-[13px] leading-5 break-all whitespace-pre-wrap">
                {commandOf(event)}
              </span>
              <span className="text-right font-mono text-[11.5px]" style={{ color: "var(--ink3)" }}>
                {running ? "…" : ""}
              </span>
            </button>
            {open ? (
              <pre
                className="mx-4 mb-2 overflow-auto rounded-md border p-2.5 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap"
                style={{
                  background: "var(--sunk)",
                  borderColor: "var(--line)",
                  color: "var(--ink2)",
                }}
              >
                {event.output?.trim() || "No output stored for this call."}
              </pre>
            ) : null}
          </div>
        );
      })}
    </>
  );
}

function SettledStrip({
  label,
  status,
  agents,
  open,
  expanded,
  tags,
  onToggleGroup,
  onToggleAgent,
  onOpen,
}: {
  label: string;
  status: BoardStatus;
  agents: ReadonlyArray<ChatAgentStatus>;
  open: boolean;
  expanded: Readonly<Record<string, boolean>>;
  tags: Map<string, string>;
  onToggleGroup: () => void;
  onToggleAgent: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  if (agents.length === 0) return null;
  const paint = statusPaint(status);
  return (
    <section
      className="shrink-0 border-t"
      style={{ borderColor: "var(--line)", background: "var(--sunk)" }}
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left"
        onClick={onToggleGroup}
      >
        <span aria-hidden className="size-2 rounded-full" style={{ background: paint.fg }} />
        <span className="text-sm font-semibold">
          {label} · {agents.length}
        </span>
        <span className="ms-auto font-mono text-xs" style={{ color: "var(--ink3)" }}>
          {open ? "Hide" : "Show"}
        </span>
      </button>
      {open ? (
        <ul className="max-h-56 overflow-auto border-t" style={{ borderColor: "var(--line)" }}>
          {agents.map((agent) => {
            const identity = agentIdentity(agent);
            const shown = expanded[agent.id] === true;
            return (
              <li key={agent.id} className="border-b" style={{ borderColor: "var(--line)" }}>
                <button
                  type="button"
                  className="flex w-full min-w-0 items-center gap-3 px-4 py-2 text-left"
                  onClick={() => onToggleAgent(agent.id)}
                >
                  <span className="truncate font-mono text-sm">
                    {identity.title}
                    {tags.get(agent.id) ? ` ${tags.get(agent.id)}` : ""}
                  </span>
                  {identity.model ? (
                    <span
                      className="min-w-0 flex-1 truncate font-mono text-xs"
                      style={{ color: "var(--ink3)" }}
                    >
                      {identity.model}
                    </span>
                  ) : (
                    <span className="flex-1" />
                  )}
                  <span className="shrink-0 font-mono text-xs" style={{ color: paint.fg }}>
                    {shown ? "Hide" : statusLabel(status)}
                  </span>
                </button>
                {shown ? (
                  <div className="px-4 pb-3">
                    <p className="text-sm whitespace-pre-wrap" style={{ color: "var(--ink2)" }}>
                      {outcomeText(agent, status)}
                    </p>
                    <button
                      type="button"
                      className="mt-2 rounded-md border px-3 py-1.5 text-sm"
                      style={{ borderColor: "var(--line)" }}
                      onClick={() => onOpen(agent.id)}
                    >
                      Full log
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}

export const AgentChatBoard = memo(function AgentChatBoard({
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
  const [view, setView] = useState<"grid" | "focus">("grid");
  const [filter, setFilter] = useState<ToolFilter>("All");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [doneOpen, setDoneOpen] = useState(false);
  const [failedOpen, setFailedOpen] = useState(false);
  const [openSettled, setOpenSettled] = useState<Record<string, boolean>>({});
  useEffect(() => {
    const id = "argus-ibm-plex";
    if (document.getElementById(id)) return;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href =
      "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap";
    document.head.appendChild(link);
  }, []);
  const tags = useMemo(() => tagsFor(agents), [agents]);
  const index = Math.max(
    0,
    agents.findIndex((agent) => agent.id === focusId),
  );
  const selected = agents[index] ?? agents[0];

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isContextMenuOpen()) return;
      const target = event.target;
      const typing = target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement;
      if (event.key === "Escape" && view === "focus" && !typing) {
        event.preventDefault();
        event.stopPropagation();
        setView("grid");
        return;
      }
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      if (event.altKey || event.metaKey || event.ctrlKey || event.shiftKey || typing) return;
      if (agents.length < 2) return;
      event.preventDefault();
      event.stopPropagation();
      const next = stepAgentStackIndex(index, agents.length, event.key === "ArrowRight" ? 1 : -1);
      const agent = agents[next];
      if (!agent) return;
      setFilter("All");
      onFocus(agent.id);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [agents, index, onFocus, view]);

  if (!selected) return null;

  function toggle(key: string) {
    setExpanded((current) => ({ ...current, [key]: !current[key] }));
  }

  function draftOf(agentId: string) {
    return drafts[agentId] ?? "";
  }

  function send(agent: ChatAgentStatus) {
    const text = draftOf(agent.id).trim();
    if (!text || !onFollowUp) return;
    onFollowUp(agent, text);
    setDrafts((current) => ({ ...current, [agent.id]: "" }));
  }

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
        viewportClassName="z-[60] px-2 py-2"
        className="argus-agent-chat h-[96vh] max-h-[96vh]! w-[96vw] max-w-none! overflow-hidden border bg-[#0d0d0c]! p-0 shadow-none backdrop-blur-none!"
        style={{ borderColor: "var(--line)", background: "var(--bg)" }}
      >
        {view === "grid" ? (
          <div className="flex h-full min-h-0 flex-col">
            <div
              className="grid min-h-0 flex-1 content-start gap-4 overflow-auto p-4"
              style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 560px), 1fr))" }}
            >
              {agents
                .filter((agent) => agent.state === "working" || agent.state === "idle")
                .map((agent) => {
                  const status = boardStatus(agent.state);
                  const paint = statusPaint(status);
                  const recent = [...agent.events].reverse();
                  const earlier = 0;
                  return (
                    <article
                      key={agent.id}
                      className="flex min-h-80 w-full min-w-0 flex-col overflow-hidden border"
                      style={{
                        background: "var(--panel)",
                        borderColor: agent.id === selected.id ? "var(--ink3)" : "var(--line)",
                        borderRadius: 12,
                      }}
                      onClick={() => onFocus(agent.id)}
                    >
                      <header className="flex items-start gap-3 px-[18px] pt-4 pb-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline gap-2">
                            <span className="truncate font-mono text-sm font-semibold">
                              {agentIdentity(agent).title}
                            </span>
                            {tags.get(agent.id) ? (
                              <span
                                className="shrink-0 font-mono text-sm"
                                style={{ color: "var(--ink3)" }}
                              >
                                {tags.get(agent.id)}
                              </span>
                            ) : null}
                          </div>
                          {agentIdentity(agent).model ? (
                            <p className="mt-1 font-mono text-xs" style={{ color: "var(--ink3)" }}>
                              {agentIdentity(agent).model}
                            </p>
                          ) : null}
                        </div>
                        <div className="text-right">
                          <StatusMark status={status} />
                          <p className="mt-1 font-mono text-xs" style={{ color: "var(--ink3)" }}>
                            {agent.events.length} steps
                          </p>
                        </div>
                      </header>
                      <div
                        className="mx-[18px] rounded-lg border px-3.5 py-3"
                        style={{ background: paint.bg, borderColor: paint.line }}
                      >
                        <p
                          className="font-mono text-[11px] font-semibold tracking-wide"
                          style={{ color: paint.fg }}
                        >
                          {status === "running"
                            ? "NOW"
                            : status === "failed"
                              ? "FAILED"
                              : status === "waiting"
                                ? "NEEDS YOU"
                                : "RESULT"}
                        </p>
                        <p className="mt-1 text-sm leading-snug font-medium break-words">
                          {outcomeText(agent, status)}
                        </p>
                      </div>
                      <div
                        className="mt-3 min-h-0 flex-1 overflow-y-auto border-t"
                        style={{ borderColor: "var(--line)" }}
                      >
                        <CallRows
                          agent={agent}
                          events={recent}
                          newestFirst
                          expanded={expanded}
                          onToggle={toggle}
                        />
                        {earlier > 0 ? (
                          <p
                            className="px-[18px] py-2 font-mono text-xs"
                            style={{ color: "var(--ink3)" }}
                          >
                            + {earlier} earlier calls
                          </p>
                        ) : null}
                      </div>
                      <footer
                        className="flex items-center gap-2 border-t px-3 py-2.5"
                        style={{ background: "var(--sunk)", borderColor: "var(--line)" }}
                      >
                        <form
                          className="flex min-w-0 flex-1 items-center gap-2"
                          onSubmit={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            send(agent);
                          }}
                        >
                          <input
                            value={draftOf(agent.id)}
                            placeholder={`Message ${agentIdentity(agent).title}${tags.get(agent.id) ? ` ${tags.get(agent.id)}` : ""}`}
                            className="min-w-0 flex-1 rounded-md border px-3 py-2 text-sm outline-none"
                            style={{ background: "var(--panel)", borderColor: "var(--line)" }}
                            onClick={(event) => event.stopPropagation()}
                            onChange={(event) => {
                              onFocus(agent.id);
                              const value = event.target.value;
                              setDrafts((current) => ({ ...current, [agent.id]: value }));
                            }}
                          />
                          <button
                            type="submit"
                            className="rounded-md px-3 py-2 text-sm"
                            style={{ background: "var(--ink)", color: "var(--panel)" }}
                            onClick={(event) => event.stopPropagation()}
                          >
                            Send
                          </button>
                        </form>
                        <button
                          type="button"
                          className="rounded-md border px-3 py-2 text-sm"
                          style={{ borderColor: "var(--line)" }}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            setFilter("All");
                            setView("focus");
                            onFocus(agent.id);
                          }}
                        >
                          Full log
                        </button>
                      </footer>
                    </article>
                  );
                })}
            </div>
            <SettledStrip
              label="Done"
              status="done"
              agents={agents.filter((agent) => agent.state === "done" || agent.state === "stopped")}
              open={doneOpen}
              expanded={openSettled}
              tags={tags}
              onToggleGroup={() => setDoneOpen((open) => !open)}
              onToggleAgent={(id) =>
                setOpenSettled((current) => ({ ...current, [id]: !current[id] }))
              }
              onOpen={(id) => {
                setFilter("All");
                setView("focus");
                onFocus(id);
              }}
            />
            <SettledStrip
              label="Failed"
              status="failed"
              agents={agents.filter((agent) => agent.state === "failed")}
              open={failedOpen}
              expanded={openSettled}
              tags={tags}
              onToggleGroup={() => setFailedOpen((open) => !open)}
              onToggleAgent={(id) =>
                setOpenSettled((current) => ({ ...current, [id]: !current[id] }))
              }
              onOpen={(id) => {
                setFilter("All");
                setView("focus");
                onFocus(id);
              }}
            />
          </div>
        ) : (
          <FocusView
            agents={agents}
            selected={selected}
            tags={tags}
            filter={filter}
            expanded={expanded}
            draft={draftOf(selected.id)}
            onDraft={(value) => setDrafts((current) => ({ ...current, [selected.id]: value }))}
            onFilter={setFilter}
            onToggle={toggle}
            onExpandAll={(open) => {
              const next: Record<string, boolean> = { ...expanded };
              for (const event of selected.events) next[`${selected.id}:${event.id}`] = open;
              setExpanded(next);
            }}
            onSelect={(id) => {
              setFilter("All");
              onFocus(id);
            }}
            onGrid={() => setView("grid")}
            onSend={() => send(selected)}
          />
        )}
      </DialogPopup>
    </Dialog>
  );
});

function FocusView({
  agents,
  selected,
  tags,
  filter,
  expanded,
  draft,
  onDraft,
  onFilter,
  onToggle,
  onExpandAll,
  onSelect,
  onGrid,
  onSend,
}: {
  agents: ReadonlyArray<ChatAgentStatus>;
  selected: ChatAgentStatus;
  tags: Map<string, string>;
  filter: ToolFilter;
  expanded: Readonly<Record<string, boolean>>;
  draft: string;
  onDraft: (value: string) => void;
  onFilter: (filter: ToolFilter) => void;
  onToggle: (key: string) => void;
  onExpandAll: (open: boolean) => void;
  onSelect: (id: string) => void;
  onGrid: () => void;
  onSend: () => void;
}) {
  const status = boardStatus(selected.state);
  const paint = statusPaint(status);
  const selectedIdentity = agentIdentity(selected);
  const visible = selected.events.filter((event) => {
    if (filter === "All") return true;
    if (filter === "Errors") return event.state === "failed";
    return toolKind(event.label) === filter;
  });
  const allOpen = visible.every((event) => expanded[`${selected.id}:${event.id}`]);
  const findings = selected.files.length > 0 ? selected.files : [];
  return (
    <div
      className="grid h-full min-h-0"
      style={{ gridTemplateRows: "auto minmax(0,1fr)", background: "var(--panel)" }}
    >
      <header
        className="flex items-center gap-2 overflow-x-auto border-b px-4 py-3"
        style={{ background: "var(--sunk)", borderColor: "var(--line)" }}
      >
        <button
          type="button"
          className="flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-sm"
          style={{ borderColor: "var(--line)" }}
          onClick={onGrid}
        >
          <span aria-hidden className="grid size-3.5 grid-cols-2 gap-0.5">
            <span className="bg-current" />
            <span className="bg-current" />
            <span className="bg-current" />
            <span className="bg-current" />
          </span>
          Grid
        </button>
        {agents.map((agent) => {
          const agentStatus = boardStatus(agent.state);
          const active = agent.id === selected.id;
          return (
            <button
              key={agent.id}
              type="button"
              className="grid shrink-0 rounded-lg border px-3 py-2 text-left"
              style={{
                gridTemplateColumns: "8px 1fr",
                columnGap: 8,
                background: active ? "var(--panel)" : "transparent",
                borderColor: active ? "var(--ink3)" : "var(--line)",
              }}
              onClick={() => onSelect(agent.id)}
            >
              <span
                className="mt-1 size-2 rounded-full"
                style={{ background: statusPaint(agentStatus).fg }}
              />
              <span className="font-mono text-sm whitespace-nowrap">
                {agentIdentity(agent).title}
                {tags.get(agent.id) ? ` ${tags.get(agent.id)}` : ""}
              </span>
              <span />
              <span
                className="font-mono text-xs whitespace-nowrap"
                style={{ color: "var(--ink3)" }}
              >
                {statusLabel(agentStatus)}
              </span>
            </button>
          );
        })}
        <span className="ms-auto shrink-0 font-mono text-xs" style={{ color: "var(--ink3)" }}>
          ← → switch agent · Esc back to grid
        </span>
      </header>
      <div
        className="grid min-h-0"
        style={{ gridTemplateColumns: "minmax(280px, 580px) minmax(0,1fr)" }}
      >
        <section className="flex min-h-0 flex-col border-r" style={{ borderColor: "var(--line)" }}>
          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-7 py-6">
            <div>
              <p className="font-mono text-xs tracking-wide" style={{ color: "var(--ink3)" }}>
                TASK · {selected.events.length} STEPS
              </p>
              <h2 className="mt-2 text-[22px] leading-snug font-semibold">
                {selectedIdentity.title}
              </h2>
              {selectedIdentity.model ? (
                <p className="mt-1 font-mono text-xs" style={{ color: "var(--ink3)" }}>
                  {selectedIdentity.model}
                </p>
              ) : null}
            </div>
            <div
              className="rounded-[10px] border p-[18px]"
              style={{ background: paint.bg, borderColor: paint.line }}
            >
              <p
                className="font-mono text-xs font-semibold tracking-wide"
                style={{ color: paint.fg }}
              >
                {status === "running"
                  ? "NOW"
                  : status === "failed"
                    ? "FAILED"
                    : status === "waiting"
                      ? "NEEDS YOUR INPUT"
                      : "RESULT"}
              </p>
              <p className="mt-2 text-base leading-snug font-medium">
                {outcomeText(selected, status)}
              </p>
            </div>
            {findings.length > 0 ? (
              <div>
                <p className="font-mono text-xs tracking-wide" style={{ color: "var(--ink3)" }}>
                  CHANGES
                </p>
                <ul className="mt-2 text-[15px] leading-normal" style={{ color: "var(--ink2)" }}>
                  {findings.map((file) => (
                    <li key={file}>— {file}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {selected.transcript.trim().length > 0 ? (
              <div className="border-t pt-4" style={{ borderColor: "var(--line)" }}>
                <p className="font-mono text-xs tracking-wide" style={{ color: "var(--ink3)" }}>
                  MESSAGES
                </p>
                <p
                  className="mt-2 text-[15px] leading-normal whitespace-pre-wrap"
                  style={{ color: "var(--ink2)" }}
                >
                  {selected.transcript.trim()}
                </p>
              </div>
            ) : null}
          </div>
          <form
            className="border-t px-5 pt-3.5 pb-4"
            style={{ borderColor: "var(--line)" }}
            onSubmit={(event) => {
              event.preventDefault();
              onSend();
            }}
          >
            <div
              className="flex items-end gap-2 rounded-[10px] border p-2"
              style={{ background: "var(--sunk)", borderColor: "var(--line)" }}
            >
              <textarea
                rows={2}
                value={draft}
                placeholder={`Message ${selectedIdentity.title}`}
                className="min-w-0 flex-1 resize-none bg-transparent px-2 py-1 text-[15px] outline-none"
                onChange={(event) => onDraft(event.target.value)}
              />
              <button
                type="submit"
                className="rounded-md px-3 py-2 text-sm"
                style={{ background: "var(--ink)", color: "var(--panel)" }}
              >
                Send
              </button>
            </div>
          </form>
        </section>
        <section className="flex min-h-0 flex-col">
          <header
            className="flex flex-wrap items-center gap-2 border-b px-4 py-3"
            style={{ borderColor: "var(--line)" }}
          >
            <span className="text-sm font-semibold">Tool log</span>
            {(["All", "GREP", "READ", "RUN", "MCP", "Errors"] as const).map((chip) => {
              const count =
                chip === "All"
                  ? selected.events.length
                  : selected.events.filter((event) =>
                      chip === "Errors" ? event.state === "failed" : toolKind(event.label) === chip,
                    ).length;
              if (chip !== "All" && count === 0) return null;
              const active = filter === chip;
              return (
                <button
                  key={chip}
                  type="button"
                  className="rounded-md px-2.5 py-1.5 font-mono text-xs"
                  style={{
                    background: active ? "var(--ink)" : "transparent",
                    color: active ? "var(--panel)" : "var(--ink2)",
                    border: "1px solid var(--line)",
                  }}
                  onClick={() => onFilter(chip)}
                >
                  {chip} {count}
                </button>
              );
            })}
            <button
              type="button"
              className="ms-auto font-mono text-xs"
              style={{ color: "var(--ink3)" }}
              onClick={() => onExpandAll(!allOpen)}
            >
              {allOpen ? "Collapse all" : "Expand all"}
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <CallRows
              agent={selected}
              events={visible}
              newestFirst={false}
              expanded={expanded}
              onToggle={onToggle}
            />
          </div>
        </section>
      </div>
    </div>
  );
}
