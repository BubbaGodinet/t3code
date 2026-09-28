import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import {
  GlobeIcon,
  LayoutGridIcon,
  PanelRightIcon,
  PictureInPicture2Icon,
  SmartphoneIcon,
} from "lucide-react";
import { resolveProjectScripts } from "@t3tools/shared/projectScripts";
import { useEffect, useMemo, useRef } from "react";

import { resolveDiscoveredServerUrl } from "../../browser/browserTargetResolver";
import { DevicePanel } from "../../components/device/DevicePanel";
import { openPreviewSession } from "../../components/preview/openPreviewSession";
import { getConfiguredPreviewUrls } from "../../components/preview/previewEmptyStateLogic";
import { PreviewPanel } from "../../components/preview/PreviewPanel";
import { Button } from "../../components/ui/button";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuTrigger,
} from "../../components/ui/menu";
import { useEnvironmentSettings } from "../../hooks/useSettings";
import { useDiscoveredPortsState } from "../../portDiscoveryState";
import {
  selectThreadPreviewMiniPlayer,
  usePreviewMiniPlayerStore,
} from "../../previewMiniPlayerStore";
import { isPreviewSupportedInRuntime, useThreadPreviewState } from "../../previewStateStore";
import {
  selectActiveRightPanel,
  selectThreadRightPanelState,
  useRightPanelStore,
  type DeviceTabTarget,
} from "../../rightPanelStore";
import { useProject } from "../../state/entities";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { previewEnvironment } from "../../state/preview";
import { useAtomCommand } from "../../state/use-atom-command";
import { useMosaicStore, type MosaicCompany, type MosaicPane } from "./mosaicStore";
import {
  findSourcePaneId,
  findSurfacePaneId,
  sessionBrowserStartUrl,
  surfacePlacementOptions,
  type MosaicSurfaceKind,
  type MosaicSurfacePlacement,
  type MosaicSurfaceSource,
} from "./mosaicSurfaces";
import { layoutMosaic } from "./mosaicTree";
import { useMosaicActions } from "./useMosaicActions";

type BrowserPane = Extract<MosaicPane, { kind: "browser" }>;
type DevicePane = Extract<MosaicPane, { kind: "device" }>;

/** The session a browser or device opened from `pane` follows. */
export function paneSurfaceSource(
  pane: MosaicPane,
  company: MosaicCompany | null,
): MosaicSurfaceSource | null {
  switch (pane.kind) {
    case "chat":
      return pane.target?.kind === "server"
        ? { kind: "thread", threadRef: pane.target.threadRef }
        : null;
    case "terminal":
      return company?.projectRef
        ? {
            kind: "terminal",
            threadRef: scopeThreadRef(
              company.projectRef.environmentId,
              ThreadId.make(pane.sessionThreadId),
            ),
          }
        : null;
    default:
      return pane.source;
  }
}

function paneBox(
  state: Pick<ReturnType<typeof useMosaicStore.getState>, "floating" | "root">,
  paneId: string,
) {
  return (
    state.floating[paneId] ?? layoutMosaic(state.root).panes.find((p) => p.paneId === paneId)?.rect
  );
}

function paneRect(paneId: string) {
  return paneBox(useMosaicStore.getState(), paneId);
}

/** Opens the thread's own side panel on the browser or device, and brings its chat forward. */
function useShowInChat() {
  const { focusPane, openTarget } = useMosaicActions();
  return (kind: MosaicSurfaceKind, threadRef: ScopedThreadRef, device: DeviceTabTarget | null) => {
    const panel = useRightPanelStore.getState();
    if (kind === "browser") panel.open(threadRef, "preview");
    else if (device) panel.openDevice(threadRef, device);
    else panel.open(threadRef, "device");
    const chatPaneId = findSourcePaneId(useMosaicStore.getState(), { kind: "thread", threadRef });
    if (chatPaneId) focusPane(chatPaneId);
    else openTarget({ kind: "server", threadRef });
  };
}

/**
 * Takes the device a chat is showing out of it, so moving it to the mosaic keeps
 * one view: the side panel's device tab (the selected one first), else the
 * device floating over the chat.
 */
function takeDeviceFromChat(threadRef: ScopedThreadRef): DeviceTabTarget | null {
  const panel = useRightPanelStore.getState();
  const thread = selectThreadRightPanelState(panel.byThreadKey, threadRef);
  const surface =
    thread.surfaces.find(
      (entry) => entry.kind === "device" && entry.target && entry.id === thread.activeSurfaceId,
    ) ?? thread.surfaces.find((entry) => entry.kind === "device" && entry.target);
  if (surface?.kind === "device" && surface.target) {
    panel.closeSurface(threadRef, surface.id);
    return surface.target;
  }
  const miniPlayer = usePreviewMiniPlayerStore.getState();
  const floating = selectThreadPreviewMiniPlayer(miniPlayer.byThreadKey, threadRef);
  if (floating?.source.kind !== "device") return null;
  miniPlayer.close(threadRef);
  const { kind: _kind, ...target } = floating.source;
  return target;
}

/** Closes the chat's own browser, side panel or floating, since a session's browser is one webview. */
function closeChatBrowser(threadRef: ScopedThreadRef) {
  const panel = useRightPanelStore.getState();
  if (selectActiveRightPanel(panel.byThreadKey, threadRef) === "preview") panel.close(threadRef);
  const miniPlayer = usePreviewMiniPlayerStore.getState();
  const floating = selectThreadPreviewMiniPlayer(miniPlayer.byThreadKey, threadRef);
  if (floating?.source.kind === "browser") miniPlayer.close(threadRef);
}

const PLACEMENT_ICONS: Record<MosaicSurfacePlacement, typeof PanelRightIcon> = {
  chat: PanelRightIcon,
  float: PictureInPicture2Icon,
  pane: LayoutGridIcon,
};

function LaunchMenu({
  kind,
  source,
  onLaunch,
}: {
  kind: MosaicSurfaceKind;
  source: MosaicSurfaceSource | null;
  onLaunch: (placement: MosaicSurfacePlacement) => void;
}) {
  const options = surfacePlacementOptions({
    kind,
    source,
    browserSupported: isPreviewSupportedInRuntime(),
  });
  const label = kind === "browser" ? "Browser for this session" : "Emulator for this session";
  return (
    <Menu>
      <MenuTrigger
        render={<Button aria-label={label} title={label} size="icon-micro" variant="ghost-muted" />}
      >
        {kind === "browser" ? <GlobeIcon /> : <SmartphoneIcon />}
      </MenuTrigger>
      <MenuPopup align="end">
        <MenuGroup>
          <MenuGroupLabel>{kind === "browser" ? "Open browser" : "Open emulator"}</MenuGroupLabel>
          {options.map(({ placement, label: optionLabel, disabledReason }) => {
            const Icon = PLACEMENT_ICONS[placement];
            return (
              <MenuItem
                key={placement}
                disabled={disabledReason !== null}
                onClick={() => onLaunch(placement)}
              >
                <Icon />
                <span className="flex min-w-0 flex-col">
                  {optionLabel}
                  {disabledReason ? (
                    <span className="max-w-56 text-xs text-muted-foreground">{disabledReason}</span>
                  ) : null}
                </span>
              </MenuItem>
            );
          })}
        </MenuGroup>
      </MenuPopup>
    </Menu>
  );
}

/** The browser and emulator icons on every pane header, each offering the three placements. */
export function SurfaceLaunchMenus({
  pane,
  company,
}: {
  pane: MosaicPane;
  company: MosaicCompany | null;
}) {
  const source = paneSurfaceSource(pane, company);
  const showInChat = useShowInChat();
  const { closePane, focusPane } = useMosaicActions();
  const launch = (kind: MosaicSurfaceKind, placement: MosaicSurfacePlacement) => {
    const state = useMosaicStore.getState();
    // A session's browser is one webview; only one place can show it at a time.
    const openBrowserId = kind === "browser" ? findSurfacePaneId(state, "browser", source) : null;
    if (placement === "chat") {
      if (source?.kind === "thread") {
        if (openBrowserId) closePane(openBrowserId);
        showInChat(kind, source.threadRef, pane.kind === "device" ? pane.device : null);
        if (pane.kind === "device") closePane(pane.id);
      }
      return;
    }
    if (kind === "browser" && source?.kind === "thread") closeChatBrowser(source.threadRef);
    if (openBrowserId) {
      const floating = state.floating[openBrowserId] !== undefined;
      const slot = paneRect(openBrowserId);
      if (placement === "float" && !floating && slot) state.toggleFloating(openBrowserId, slot);
      else if (placement === "pane" && floating) state.dockFloating(openBrowserId);
      focusPane(openBrowserId);
      return;
    }
    if (pane.kind === "device" && kind === "device") {
      const floating = state.floating[pane.id] !== undefined;
      const slot = paneRect(pane.id);
      if (placement === "float" && !floating && slot) state.toggleFloating(pane.id, slot);
      else if (placement === "pane" && floating) state.dockFloating(pane.id);
      return;
    }
    const chatDevice =
      kind === "device" && source?.kind === "thread" ? takeDeviceFromChat(source.threadRef) : null;
    const paneId = state.openSurfacePane({
      kind,
      placement,
      source,
      companyId: company?.id ?? pane.companyId,
      origin: { paneId: pane.id, slot: paneRect(pane.id) ?? null },
    });
    if (chatDevice) state.setPaneDevice(paneId, chatDevice);
  };
  return (
    <>
      <LaunchMenu
        kind="browser"
        source={source}
        onLaunch={(placement) => launch("browser", placement)}
      />
      <LaunchMenu
        kind="device"
        source={source}
        onLaunch={(placement) => launch("device", placement)}
      />
    </>
  );
}

/** Sends a browser or device pane back into its chat's side panel, closing the pane. */
export function ShowInChatButton({ pane }: { pane: BrowserPane | DevicePane }) {
  const showInChat = useShowInChat();
  const { closePane } = useMosaicActions();
  if (pane.source?.kind !== "thread") return null;
  if (pane.kind === "browser" && !isPreviewSupportedInRuntime()) return null;
  const threadRef = pane.source.threadRef;
  return (
    <Button
      aria-label="Show in the chat"
      title="Send back into the chat's side panel"
      size="icon-micro"
      variant="ghost-muted"
      onClick={() => {
        showInChat(pane.kind, threadRef, pane.kind === "device" ? pane.device : null);
        closePane(pane.id);
      }}
    >
      <PanelRightIcon />
    </Button>
  );
}

/**
 * The thread a pane's browser or device belongs to: its source session, else a
 * thread of the pane's own so T3 can keep its tabs and device sessions.
 */
function usePaneSurfaceThreadRef(
  pane: BrowserPane | DevicePane,
  company: MosaicCompany | null,
): ScopedThreadRef | null {
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const environmentId =
    pane.source?.threadRef.environmentId ??
    company?.projectRef?.environmentId ??
    primaryEnvironmentId;
  return useMemo(
    () =>
      pane.source?.threadRef ??
      (environmentId
        ? scopeThreadRef(environmentId, ThreadId.make(`argus-${pane.kind}-${pane.id}`))
        : null),
    [environmentId, pane.id, pane.kind, pane.source],
  );
}

function NoEnvironment() {
  return <p className="p-4 text-sm text-muted-foreground">Connect to an environment first.</p>;
}

/** Grid browsers sit under floating panes; a floating browser sits over the grid and its peers. */
const GRID_BROWSER_Z_INDEX = 20;
const FLOATING_BROWSER_Z_INDEX = 35;
const ACTIVE_FLOATING_BROWSER_Z_INDEX = 45;

/**
 * The pane's session in T3's Browser panel: the same preview tab and webview the
 * chat's side panel shows, following the pane when it floats or moves.
 */
export function BrowserSurfaceView({
  pane,
  company,
}: {
  pane: BrowserPane;
  company: MosaicCompany | null;
}) {
  const threadRef = usePaneSurfaceThreadRef(pane, company);
  if (threadRef === null) return <NoEnvironment />;
  if (!isPreviewSupportedInRuntime()) {
    return <PreviewPanel mode="embedded" threadRef={threadRef} visible />;
  }
  return <SessionBrowser pane={pane} company={company} threadRef={threadRef} />;
}

function SessionBrowser({
  pane,
  company,
  threadRef,
}: {
  pane: BrowserPane;
  company: MosaicCompany | null;
  threadRef: ScopedThreadRef;
}) {
  const layoutVersion = useMosaicStore((state) => {
    const box = paneBox(state, pane.id);
    return box ? `${box.x}:${box.y}:${box.width}:${box.height}` : "";
  });
  const zIndex = useMosaicStore((state) =>
    state.floating[pane.id] === undefined
      ? GRID_BROWSER_Z_INDEX
      : state.activePaneId === pane.id
        ? ACTIVE_FLOATING_BROWSER_Z_INDEX
        : FLOATING_BROWSER_Z_INDEX,
  );
  const project = useProject(company?.projectRef ?? null);
  const settings = useEnvironmentSettings(threadRef.environmentId);
  const configuredUrls = useMemo(
    () => getConfiguredPreviewUrls(project ? resolveProjectScripts(settings, project) : []),
    [project, settings],
  );
  useOpenKnownSessionPage(threadRef, pane.url);
  return (
    <PreviewPanel
      mode="embedded"
      threadRef={threadRef}
      configuredUrls={configuredUrls}
      visible
      surfaceZIndex={zIndex}
      surfaceLayoutVersion={layoutVersion}
    />
  );
}

/**
 * Opens the page T3 already knows for a session that has no browser tab yet: a
 * URL the pane was saved with, else the lowest-port dev server its terminals
 * started. Runs once per pane, after the server's tab list arrives, so it never
 * duplicates or reopens a tab the user closed.
 */
function useOpenKnownSessionPage(threadRef: ScopedThreadRef, pinnedUrl: string | null) {
  const preview = useThreadPreviewState(threadRef);
  const { servers } = useDiscoveredPortsState(threadRef.environmentId);
  const open = useAtomCommand(previewEnvironment.open);
  const settledRef = useRef(false);
  const loaded = preview.serverEpoch !== null;
  const hasTab = Object.keys(preview.sessions).length > 0;
  const target = sessionBrowserStartUrl({
    pinnedUrl,
    sessionServers: servers.filter((server) => server.terminal?.threadId === threadRef.threadId),
  });
  useEffect(() => {
    if (settledRef.current || !loaded) return;
    if (hasTab) {
      settledRef.current = true;
      return;
    }
    if (!target) return;
    settledRef.current = true;
    void openPreviewSession({
      openPreview: open,
      threadRef,
      url: resolveDiscoveredServerUrl(threadRef.environmentId, target),
    });
  }, [hasTab, loaded, open, target, threadRef]);
}

/**
 * The pane's session in T3's Device panel, as the chat's side panel shows it.
 * The pane keeps the chosen device so a saved layout reopens it, and closing
 * the device closes the pane.
 */
export function DeviceSurfaceView({
  pane,
  company,
}: {
  pane: DevicePane;
  company: MosaicCompany | null;
}) {
  const setPaneDevice = useMosaicStore((state) => state.setPaneDevice);
  const { closePane } = useMosaicActions();
  const threadRef = usePaneSurfaceThreadRef(pane, company);
  const surface = useMemo(
    () => ({
      id: "device" as const,
      kind: "device" as const,
      ...(pane.device ? { target: pane.device } : {}),
    }),
    [pane.device],
  );
  const host = useMemo(
    () => ({
      onDeviceOpened: (target: DeviceTabTarget) => setPaneDevice(pane.id, target),
      onClose: () => closePane(pane.id),
    }),
    [closePane, pane.id, setPaneDevice],
  );
  if (threadRef === null) return <NoEnvironment />;
  return (
    <DevicePanel
      mode="embedded"
      threadRef={threadRef}
      surface={surface}
      visible
      host={host}
      onDismissSetup={host.onClose}
    />
  );
}
