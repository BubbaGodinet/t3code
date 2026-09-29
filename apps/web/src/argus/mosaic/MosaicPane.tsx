import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { useNavigate } from "@tanstack/react-router";
import {
  BuildingIcon,
  CheckIcon,
  Columns2Icon,
  GlobeIcon,
  GripVerticalIcon,
  MessageSquarePlusIcon,
  PictureInPicture2Icon,
  Rows2Icon,
  SmartphoneIcon,
  SquareTerminalIcon,
  XIcon,
} from "lucide-react";
import {
  memo,
  useCallback,
  useMemo,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { ThreadRouteView } from "../../components/ThreadRouteView";
import { Button } from "../../components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../../components/ui/menu";
import { useComposerDraftStore } from "../../composerDraftStore";
import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { cn } from "../../lib/utils";
import { useThreadShell, useThreadShells } from "../../state/entities";
import type { ThreadRouteTarget } from "../../threadRoutes";
import { ChatPaneContext } from "./chatPaneContext";
import { useCompaniesDialog } from "./CompaniesDialog";
import {
  resolvePaneCompany,
  useMosaicStore,
  type MosaicCompany,
  type MosaicPane,
} from "./mosaicStore";
import {
  BrowserSurfaceView,
  DeviceSurfaceView,
  ShowInChatButton,
  SurfaceLaunchMenus,
} from "./SurfacePanes";
import { TerminalPane } from "./TerminalPane";
import { useMosaicActions } from "./useMosaicActions";

const RECENT_THREAD_LIMIT = 12;

function tint(color: string, percent: number): string {
  return `color-mix(in srgb, ${color} ${percent}%, transparent)`;
}

function CompanyMenu({ pane, company }: { pane: MosaicPane; company: MosaicCompany | null }) {
  const companies = useMosaicStore((state) => state.companies);
  const setPaneCompany = useMosaicStore((state) => state.setPaneCompany);
  const openCompanies = useCompaniesDialog((state) => state.setOpen);
  const { applyCompanyAgent } = useMosaicActions();
  const assignCompany = (entry: MosaicCompany) => {
    setPaneCompany(pane.id, entry.id);
    void applyCompanyAgent(pane, entry);
  };
  return (
    <Menu>
      <MenuTrigger
        render={
          <button
            type="button"
            className="flex min-w-0 items-center gap-1.5 rounded px-1 text-xs font-medium hover:bg-accent"
          />
        }
      >
        <span
          className="size-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: company?.color ?? "var(--muted-foreground)" }}
        />
        <span className="truncate">{company?.name ?? "No company"}</span>
      </MenuTrigger>
      <MenuPopup align="start">
        {companies.map((entry) => (
          <MenuItem key={entry.id} onClick={() => assignCompany(entry)}>
            <span className="size-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
            {entry.name}
            {pane.companyId === entry.id ? <CheckIcon className="ms-auto size-3.5" /> : null}
          </MenuItem>
        ))}
        {companies.length > 0 ? <MenuSeparator /> : null}
        <MenuItem onClick={() => openCompanies(true)}>
          <BuildingIcon />
          Manage companies…
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}

/** Empty chat pane: start a chat in the pane's company or open a recent thread. */
function ChatPanePicker({ pane, company }: { pane: MosaicPane; company: MosaicCompany | null }) {
  const threads = useThreadShells();
  const handleNewThread = useNewThreadHandler();
  const { openTarget } = useMosaicActions();
  const openCompanies = useCompaniesDialog((state) => state.setOpen);
  const companyProjectRef = company?.projectRef ?? null;
  const recent = useMemo(
    () =>
      threads
        .filter(
          (thread) =>
            thread.archivedAt === null &&
            (!companyProjectRef ||
              (thread.environmentId === companyProjectRef.environmentId &&
                thread.projectId === companyProjectRef.projectId)),
        )
        .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, RECENT_THREAD_LIMIT),
    [companyProjectRef, threads],
  );

  const startChat = async () => {
    if (!company?.projectRef) return;
    const store = useMosaicStore.getState();
    store.setActivePane(pane.id);
    const opened = await handleNewThread(company.projectRef);
    if (!opened) return;
    if (company.modelSelection) {
      useComposerDraftStore.getState().setModelSelection(opened.draftId, company.modelSelection, {
        explicit: true,
        replaceOptions: true,
      });
    }
    // The handler may reuse an empty draft that is already on screen and skip navigation.
    useMosaicStore
      .getState()
      .syncRouteTarget({ kind: "draft", draftId: opened.draftId }, "navigate");
  };

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-4 text-sm">
      {company?.projectRef ? (
        <Button className="self-start" size="sm" onClick={() => void startChat()}>
          <MessageSquarePlusIcon />
          New chat in {company.name}
        </Button>
      ) : (
        <div className="flex flex-col items-start gap-2 text-muted-foreground">
          {company
            ? `${company.name} has no repository yet.`
            : "Pick a company for this pane, or open any thread below."}
          <Button size="sm" variant="outline" onClick={() => openCompanies(true)}>
            <BuildingIcon />
            Manage companies
          </Button>
        </div>
      )}
      {recent.length > 0 ? (
        <div className="flex flex-col gap-0.5">
          <div className="px-2 pb-1 text-xs text-muted-foreground">Recent threads</div>
          {recent.map((thread) => (
            <button
              key={`${thread.environmentId}:${thread.id}`}
              type="button"
              className="truncate rounded px-2 py-1 text-left hover:bg-accent"
              onClick={() => {
                useMosaicStore.getState().setActivePane(pane.id);
                openTarget({
                  kind: "server",
                  threadRef: { environmentId: thread.environmentId, threadId: thread.id },
                });
              }}
            >
              {thread.title}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function TerminalPanePicker({ pane }: { pane: MosaicPane }) {
  const companies = useMosaicStore((state) => state.companies);
  const setPaneCompany = useMosaicStore((state) => state.setPaneCompany);
  const openCompanies = useCompaniesDialog((state) => state.setOpen);
  const withRepo = companies.filter((company) => company.projectRef !== null);
  return (
    <div className="flex h-full flex-col items-start gap-2 p-4 text-sm text-muted-foreground">
      Open this terminal in a company repository:
      {withRepo.map((company) => (
        <Button
          key={company.id}
          size="sm"
          variant="outline"
          onClick={() => setPaneCompany(pane.id, company.id)}
        >
          <span className="size-2.5 rounded-full" style={{ backgroundColor: company.color }} />
          {company.name}
        </Button>
      ))}
      <Button size="sm" variant="ghost" onClick={() => openCompanies(true)}>
        <BuildingIcon />
        Manage companies
      </Button>
    </div>
  );
}

export const MosaicPaneView = memo(function MosaicPaneView({
  paneId,
  active,
  floating,
  onStartDrag,
  onToggleFloat,
}: {
  paneId: string;
  active: boolean;
  floating: boolean;
  /**
   * Begins a drag from the header grip: a docked pane swaps slots, a floating
   * one moves. Gutters stay dedicated to resizing.
   */
  onStartDrag: (paneId: string, event: ReactPointerEvent<HTMLElement>) => void;
  /** Pops the pane out over the grid, or docks it back into its slot. */
  onToggleFloat: (paneId: string) => void;
}) {
  const pane = useMosaicStore((state) => state.panes[paneId]);
  const companies = useMosaicStore((state) => state.companies);
  const addPane = useMosaicStore((state) => state.addPane);
  const setPaneTarget = useMosaicStore((state) => state.setPaneTarget);
  const navigate = useNavigate();
  const { focusPane, closePane, openTarget } = useMosaicActions();
  const chatTarget = pane?.kind === "chat" ? pane.target : null;
  const sessionThreadRef =
    chatTarget?.kind === "server"
      ? chatTarget.threadRef
      : (pane?.kind === "browser" || pane?.kind === "device") && pane.source?.kind === "thread"
        ? pane.source.threadRef
        : null;
  const threadShell = useThreadShell(sessionThreadRef);
  const draftSession = useComposerDraftStore((store) =>
    chatTarget?.kind === "draft" ? store.getDraftSession(chatTarget.draftId) : null,
  );
  const threadProjectRef = threadShell
    ? scopeProjectRef(threadShell.environmentId, threadShell.projectId)
    : draftSession
      ? scopeProjectRef(draftSession.environmentId, draftSession.projectId)
      : null;
  const company = pane ? resolvePaneCompany(companies, pane, threadProjectRef) : null;
  // The pane keeps its own thread; the active pane then moves the route with it.
  const onTargetChange = useCallback(
    (next: ThreadRouteTarget | null) => {
      setPaneTarget(paneId, next);
      if (!active) return;
      if (next) openTarget(next);
      else void navigate({ to: "/", replace: true });
    },
    [active, navigate, openTarget, paneId, setPaneTarget],
  );
  const paneContext = useMemo(() => ({ active, inMosaic: true }), [active]);

  if (!pane) return null;

  const color = company?.color ?? null;
  const frameStyle: CSSProperties = {
    borderColor: color ? (active ? color : tint(color, 45)) : undefined,
  };
  const sessionLabel = threadShell?.title ? ` · ${threadShell.title}` : "";
  const title =
    pane.kind === "terminal"
      ? "Terminal"
      : pane.kind === "browser"
        ? `Browser${sessionLabel}`
        : pane.kind === "device"
          ? `${pane.device?.name ?? "Emulator"}${sessionLabel}`
          : (threadShell?.title ?? (chatTarget ? "New chat" : "Empty pane"));
  const KindIcon =
    pane.kind === "terminal"
      ? SquareTerminalIcon
      : pane.kind === "browser"
        ? GlobeIcon
        : pane.kind === "device"
          ? SmartphoneIcon
          : null;
  const agent =
    pane.kind === "chat"
      ? (threadShell?.modelSelection.model ?? company?.modelSelection?.model ?? null)
      : null;

  return (
    <div
      className={cn(
        "@container/pane flex h-full min-h-0 flex-col overflow-hidden rounded-lg border bg-background",
        active ? "border-2" : "border",
        !color && (active ? "border-primary" : "border-border"),
      )}
      style={frameStyle}
    >
      <div
        className="flex h-7 shrink-0 items-center gap-1.5 border-b px-1.5"
        style={
          color ? { backgroundColor: tint(color, 14), borderColor: tint(color, 35) } : undefined
        }
      >
        <button
          type="button"
          aria-label={floating ? "Drag to move" : "Drag onto another pane to swap"}
          className="flex h-5 shrink-0 cursor-grab touch-none items-center rounded text-muted-foreground hover:bg-accent active:cursor-grabbing"
          onPointerDown={(event) => onStartDrag(pane.id, event)}
        >
          <GripVerticalIcon className="size-3.5" />
        </button>
        <CompanyMenu pane={pane} company={company} />
        <span className="text-muted-foreground/60">/</span>
        {KindIcon ? <KindIcon className="size-3.5 shrink-0 text-muted-foreground" /> : null}
        <button
          type="button"
          className="min-w-0 flex-1 truncate text-left text-xs"
          onClick={() => focusPane(pane.id)}
        >
          {title}
        </button>
        {agent ? (
          <span className="hidden shrink-0 truncate text-[11px] text-muted-foreground @[28rem]/pane:inline">
            {agent}
          </span>
        ) : null}
        <SurfaceLaunchMenus pane={pane} company={company} />
        {pane.kind === "browser" || pane.kind === "device" ? (
          <ShowInChatButton pane={pane} />
        ) : null}
        <Button
          aria-label={floating ? "Dock pane" : "Pop out pane"}
          title={floating ? "Dock back into the grid" : "Pop out to a floating pane"}
          aria-pressed={floating}
          size="icon-micro"
          variant="ghost-muted"
          className={cn(floating && "bg-accent text-foreground")}
          onClick={() => onToggleFloat(pane.id)}
        >
          <PictureInPicture2Icon />
        </Button>
        <Button
          aria-label="Split right"
          size="icon-micro"
          variant="ghost-muted"
          onClick={() => addPane("chat", { beside: pane.id, direction: "row" })}
        >
          <Columns2Icon />
        </Button>
        <Button
          aria-label="Split down"
          size="icon-micro"
          variant="ghost-muted"
          onClick={() => addPane("chat", { beside: pane.id, direction: "column" })}
        >
          <Rows2Icon />
        </Button>
        <Button
          aria-label="Close pane"
          size="icon-micro"
          variant="ghost-muted"
          onClick={() => closePane(pane.id)}
        >
          <XIcon />
        </Button>
      </div>
      {/* Layout containment scopes ChatView's fixed-position header controls to this pane. */}
      <div
        className="relative min-h-0 flex-1 [contain:layout_paint]"
        onPointerDownCapture={() => focusPane(pane.id)}
      >
        <ChatPaneContext value={paneContext}>
          {pane.kind === "chat" ? (
            pane.target ? (
              <ThreadRouteView target={pane.target} embedded onTargetChange={onTargetChange} />
            ) : (
              <ChatPanePicker pane={pane} company={company} />
            )
          ) : pane.kind === "browser" ? (
            <BrowserSurfaceView pane={pane} company={company} />
          ) : pane.kind === "device" ? (
            <DeviceSurfaceView pane={pane} company={company} />
          ) : company?.projectRef ? (
            <TerminalPane pane={pane} company={company} active={active} />
          ) : (
            <TerminalPanePicker pane={pane} />
          )}
        </ChatPaneContext>
      </div>
    </div>
  );
});
