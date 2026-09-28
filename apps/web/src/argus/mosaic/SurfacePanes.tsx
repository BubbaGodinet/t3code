import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { ThreadId, type DeviceSummary, type ScopedThreadRef } from "@t3tools/contracts";
import {
  ChevronLeftIcon,
  ExternalLinkIcon,
  GlobeIcon,
  HomeIcon,
  LayoutGridIcon,
  Link2OffIcon,
  PanelRightIcon,
  PictureInPicture2Icon,
  PowerIcon,
  RefreshCwIcon,
  RepeatIcon,
  RotateCcwIcon,
  SmartphoneIcon,
  SquareIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";

import { resolveDiscoveredServerUrl } from "../../browser/browserTargetResolver";
import { DeviceLoadingView } from "../../components/device/DeviceLoadingView";
import { DeviceSetup } from "../../components/device/DeviceSetup";
import {
  DeviceStreamView,
  type DeviceStreamHandle,
} from "../../components/device/DeviceStreamView";
import { usePreviewSession } from "../../components/preview/usePreviewSession";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuTrigger,
} from "../../components/ui/menu";
import { Spinner } from "../../components/ui/spinner";
import { WizardPopup } from "../../components/ui/wizard";
import { cn } from "../../lib/utils";
import { useDiscoveredPortsState } from "../../portDiscoveryState";
import { isPreviewSupportedInRuntime, useThreadPreviewState } from "../../previewStateStore";
import { useRightPanelStore, type DeviceTabTarget } from "../../rightPanelStore";
import { deviceEnvironment, useDeviceState } from "../../state/device";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { formatEnvironmentQueryError } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { useMosaicStore, type MosaicCompany, type MosaicPane } from "./mosaicStore";
import {
  findSourcePaneId,
  groupDevicesForPicker,
  normalizeTypedUrl,
  resolveSessionBrowserUrl,
  surfacePlacementOptions,
  type MosaicBrowserUrlSource,
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

function paneRect(paneId: string) {
  const { floating, root } = useMosaicStore.getState();
  return floating[paneId] ?? layoutMosaic(root).panes.find((p) => p.paneId === paneId)?.rect;
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
    inChatBrowserSupported: isPreviewSupportedInRuntime(),
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
  const launch = (kind: MosaicSurfaceKind, placement: MosaicSurfacePlacement) => {
    if (placement === "chat") {
      if (source?.kind === "thread") {
        showInChat(kind, source.threadRef, pane.kind === "device" ? pane.device : null);
      }
      return;
    }
    useMosaicStore.getState().openSurfacePane({
      kind,
      placement,
      source,
      companyId: company?.id ?? pane.companyId,
      origin: { paneId: pane.id, slot: paneRect(pane.id) ?? null },
    });
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

function PreviewSessionSync({ threadRef }: { threadRef: ScopedThreadRef }) {
  usePreviewSession(threadRef);
  return null;
}

const URL_SOURCE_LABELS: Record<MosaicBrowserUrlSource, string> = {
  pinned: "Pinned",
  preview: "Chat preview",
  server: "Session dev server",
  none: "",
};

function ToolbarButton(props: {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      aria-label={props.label}
      title={props.label}
      size="icon-micro"
      variant="ghost-muted"
      disabled={props.disabled ?? false}
      onClick={props.onClick}
    >
      {props.children}
    </Button>
  );
}

/**
 * The session's page in a frame: what the chat's own preview shows, else a dev
 * server the session started, else a URL typed here (which stays pinned).
 */
export function BrowserSurfaceView({
  pane,
  company,
}: {
  pane: BrowserPane;
  company: MosaicCompany | null;
}) {
  const setBrowserUrl = useMosaicStore((state) => state.setBrowserUrl);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const threadRef = pane.source?.threadRef ?? null;
  const chatThreadRef = pane.source?.kind === "thread" ? pane.source.threadRef : null;
  const environmentId =
    threadRef?.environmentId ?? company?.projectRef?.environmentId ?? primaryEnvironmentId;
  const preview = useThreadPreviewState(chatThreadRef);
  const { servers } = useDiscoveredPortsState(environmentId);
  const sessionServers = useMemo(
    () =>
      threadRef ? servers.filter((server) => server.terminal?.threadId === threadRef.threadId) : [],
    [servers, threadRef],
  );
  const resolved = resolveSessionBrowserUrl({
    pinnedUrl: pane.url,
    activePreview: preview.snapshot,
    sessionServers,
  });
  const url =
    resolved.url && environmentId
      ? resolveDiscoveredServerUrl(environmentId, resolved.url)
      : resolved.url;
  const [draft, setDraft] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (draft === null) return;
    const next = normalizeTypedUrl(draft);
    if (next) setBrowserUrl(pane.id, next);
    setDraft(null);
    setReloadKey((key) => key + 1);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {chatThreadRef ? <PreviewSessionSync threadRef={chatThreadRef} /> : null}
      <form className="flex h-8 shrink-0 items-center gap-1 border-b px-1.5" onSubmit={submit}>
        <ToolbarButton
          label="Reload"
          disabled={!url}
          onClick={() => setReloadKey((key) => key + 1)}
        >
          <RefreshCwIcon />
        </ToolbarButton>
        <input
          aria-label="Address"
          className="h-6 min-w-0 flex-1 rounded-md border bg-transparent px-2 text-xs outline-none focus:border-ring"
          placeholder="Type a URL or a port"
          value={draft ?? url ?? ""}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => setDraft(null)}
        />
        {resolved.source !== "none" ? (
          <span className="hidden shrink-0 text-[11px] text-muted-foreground @[26rem]/pane:inline">
            {URL_SOURCE_LABELS[resolved.source]}
          </span>
        ) : null}
        {pane.url ? (
          <ToolbarButton
            label="Follow this session again"
            onClick={() => setBrowserUrl(pane.id, null)}
          >
            <Link2OffIcon />
          </ToolbarButton>
        ) : null}
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            aria-label="Open in a new tab"
            className="grid size-5 shrink-0 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground [&>svg]:size-3.5"
          >
            <ExternalLinkIcon />
          </a>
        ) : null}
      </form>
      <div className="relative min-h-0 flex-1">
        {url ? (
          <iframe
            key={`${url}:${reloadKey}`}
            src={url}
            title={`Browser for ${company?.name ?? "this session"}`}
            allow="clipboard-read; clipboard-write"
            // oxlint-disable-next-line react/iframe-missing-sandbox -- Dev apps need their own storage; they are another origin than T3, so allow-same-origin cannot reach this page.
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
            className="size-full border-0 bg-white"
          />
        ) : (
          <div className="flex h-full flex-col gap-3 overflow-y-auto p-4 text-sm text-muted-foreground">
            <p>
              Nothing is running for this session yet. Start a dev server from its chat or terminal,
              or type a URL above.
            </p>
            {servers.length > 0 ? (
              <div className="flex flex-col items-start gap-1">
                <span className="text-xs">Servers running on this environment</span>
                {servers.map((server) => (
                  <Button
                    key={`${server.host}:${server.port}`}
                    size="xs"
                    variant="outline"
                    onClick={() => setBrowserUrl(pane.id, server.url)}
                  >
                    <GlobeIcon />
                    {server.processName ? `${server.processName} · ` : ""}
                    {server.port}
                  </Button>
                ))}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

const deviceKey = (device: Pick<DeviceSummary, "hostId" | "id">) =>
  `${device.hostId}\u0000${device.id}`;

/**
 * A simulator or emulator for the pane's company: pick one, boot it when it is
 * stopped, and watch and drive its live screen through the environment's
 * device hub. Sessions belong to the source chat's thread, so "show in chat"
 * finds the same device already open there.
 */
export function DeviceSurfaceView({
  pane,
  company,
}: {
  pane: DevicePane;
  company: MosaicCompany | null;
}) {
  const setPaneDevice = useMosaicStore((state) => state.setPaneDevice);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const environmentId =
    pane.source?.threadRef.environmentId ??
    company?.projectRef?.environmentId ??
    primaryEnvironmentId;
  const threadId = useMemo(
    () => ThreadId.make(pane.source?.threadRef.threadId ?? `argus-device-${pane.id}`),
    [pane.id, pane.source],
  );
  const { state, loaded } = useDeviceState(environmentId);
  const list = useAtomCommand(deviceEnvironment.list, { reportFailure: false });
  const open = useAtomCommand(deviceEnvironment.open);
  const close = useAtomCommand(deviceEnvironment.close);
  const [pending, setPending] = useState<DeviceSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [handle, setHandle] = useState<DeviceStreamHandle | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const needsSetup = loaded && (!state.onboardingCompleted || state.hostStatus === "disabled");

  useEffect(() => {
    if (environmentId === null || !loaded || needsSetup) return;
    void list({ environmentId, input: {} });
  }, [environmentId, list, loaded, needsSetup]);

  const target = pane.device;
  const device = target
    ? state.devices.find((entry) => entry.hostId === target.hostId && entry.id === target.deviceId)
    : undefined;
  const session = target
    ? state.sessions.find(
        (entry) =>
          entry.threadId === threadId &&
          entry.hostId === target.hostId &&
          entry.deviceId === target.deviceId,
      )
    : undefined;
  const booting = state.bootingDevices?.some((entry) => entry.threadId === threadId) ?? false;
  const hostReady = Object.values(state.hostStatuses).some((host) => host.status === "ready");
  const hostLabel = (hostId: string) =>
    state.hosts.find((host) => host.id === hostId)?.label ?? "Device host";

  const openDevice = async (candidate: DeviceSummary) => {
    if (environmentId === null) return;
    setError(null);
    setPending(candidate);
    try {
      const result = await open({
        environmentId,
        input: {
          threadId,
          hostId: candidate.hostId,
          deviceId: candidate.id,
          platform: candidate.platform,
        },
      });
      if (result._tag === "Failure") setError(formatEnvironmentQueryError(result.cause));
      else
        setPaneDevice(pane.id, {
          hostId: result.value.hostId,
          deviceId: result.value.deviceId,
          platform: candidate.platform,
          name: candidate.name,
        });
    } finally {
      setPending(null);
    }
  };

  // A saved pane reattaches once to its running device after a server restart dropped the session;
  // a device powered off elsewhere waits for the user to start it.
  const reattachedRef = useRef(false);
  useEffect(() => {
    if (reattachedRef.current || !device?.booted || session || pending || booting || !hostReady)
      return;
    reattachedRef.current = true;
    void openDevice(device);
  });

  const release = (shutdown: boolean) => {
    if (!session || environmentId === null) {
      setPaneDevice(pane.id, null);
      return;
    }
    void close({
      environmentId,
      input: { threadId, hostId: session.hostId, deviceId: session.deviceId, shutdown },
    }).then((result) => {
      if (result._tag === "Failure") setError(formatEnvironmentQueryError(result.cause));
      else setPaneDevice(pane.id, null);
    });
  };

  if (environmentId === null) {
    return <p className="p-4 text-sm text-muted-foreground">Connect to an environment first.</p>;
  }

  if (needsSetup) {
    return (
      <div className="flex h-full flex-col items-start gap-2 p-4 text-sm text-muted-foreground">
        Device support is not set up on this environment yet.
        <Button size="sm" variant="outline" onClick={() => setSetupOpen(true)}>
          <SmartphoneIcon />
          Set up devices
        </Button>
        <Dialog open={setupOpen} onOpenChange={setSetupOpen}>
          <WizardPopup>
            <DeviceSetup environmentId={environmentId} state={state} />
          </WizardPopup>
        </Dialog>
      </div>
    );
  }

  const starting = pending !== null || booting;
  const status =
    session && device?.booted
      ? "Live"
      : starting
        ? "Starting…"
        : device
          ? device.booted
            ? "Booted"
            : "Stopped"
          : target
            ? "Unavailable"
            : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {target ? (
        <div className="flex h-8 shrink-0 items-center gap-1 border-b px-1.5">
          <span
            className={cn(
              "size-2 shrink-0 rounded-full",
              status === "Live"
                ? "bg-emerald-500"
                : starting
                  ? "bg-amber-500"
                  : "bg-muted-foreground",
            )}
          />
          <span className="min-w-0 flex-1 truncate text-xs">
            {target.name}
            <span className="text-muted-foreground">
              {" · "}
              {status}
              {device ? ` · ${hostLabel(device.hostId)} · ${device.version}` : ""}
            </span>
          </span>
          {session ? (
            <>
              <ToolbarButton
                label="Home"
                disabled={!handle?.inputConnected}
                onClick={() => handle?.pressButton("home")}
              >
                <HomeIcon />
              </ToolbarButton>
              {target.platform === "android" ? (
                <>
                  <ToolbarButton
                    label="Back"
                    disabled={!handle?.inputConnected}
                    onClick={() => handle?.pressButton("back")}
                  >
                    <ChevronLeftIcon />
                  </ToolbarButton>
                  <ToolbarButton
                    label="Recents"
                    disabled={!handle?.inputConnected}
                    onClick={() => handle?.pressButton("recents")}
                  >
                    <SquareIcon />
                  </ToolbarButton>
                </>
              ) : (
                <ToolbarButton
                  label="Rotate"
                  disabled={!handle?.inputConnected}
                  onClick={() => handle?.rotate()}
                >
                  <RotateCcwIcon />
                </ToolbarButton>
              )}
              <ToolbarButton label="Power off" onClick={() => release(true)}>
                <PowerIcon />
              </ToolbarButton>
            </>
          ) : null}
          <ToolbarButton label="Choose another device" onClick={() => release(false)}>
            <RepeatIcon />
          </ToolbarButton>
        </div>
      ) : null}
      {error ? (
        <div
          role="alert"
          className="flex items-start gap-2 border-b bg-destructive/5 px-3 py-2 text-xs text-destructive"
        >
          <p className="min-w-0 flex-1 whitespace-pre-wrap break-words">{error}</p>
          <ToolbarButton label="Dismiss" onClick={() => setError(null)}>
            <XIcon />
          </ToolbarButton>
        </div>
      ) : null}
      <div className="relative min-h-0 flex-1">
        {target && session && device ? (
          <DeviceStreamView
            key={deviceKey(device)}
            environmentId={environmentId}
            platform={device.platform}
            deviceId={device.id}
            hostId={device.hostId}
            deviceName={device.name}
            deviceDescription={`${company?.name ?? hostLabel(device.hostId)} · ${device.version}`}
            visible
            onHandle={setHandle}
          />
        ) : target && (starting || !loaded) ? (
          <DeviceLoadingView
            name={target.name}
            description={company?.name ?? ""}
            stage="opening"
            message={
              device?.booted ? "Opening device…" : "Starting device… This can take a minute."
            }
          />
        ) : target ? (
          <div className="flex h-full flex-col items-start gap-2 p-4 text-sm text-muted-foreground">
            {device
              ? `${target.name} is not connected to this pane.`
              : `${target.name} is not on this environment anymore.`}
            {device ? (
              <Button size="sm" variant="outline" onClick={() => void openDevice(device)}>
                <SmartphoneIcon />
                {device.booted ? "Reconnect" : "Start"}
              </Button>
            ) : null}
          </div>
        ) : (
          <DevicePicker
            state={state}
            loaded={loaded}
            pendingKey={pending ? deviceKey(pending) : null}
            hostLabel={hostLabel}
            onPick={(candidate) => void openDevice(candidate)}
            onRefresh={() => void list({ environmentId, input: {} })}
          />
        )}
      </div>
    </div>
  );
}

function DevicePicker(props: {
  state: ReturnType<typeof useDeviceState>["state"];
  loaded: boolean;
  pendingKey: string | null;
  hostLabel: (hostId: string) => string;
  onPick: (device: DeviceSummary) => void;
  onRefresh: () => void;
}) {
  const { state } = props;
  const groups = groupDevicesForPicker(state.devices);
  const busy = Object.values(state.hostStatuses).some(
    (host) => host.status === "installing" || host.status === "starting",
  );
  const unavailable = state.hosts.flatMap((host) =>
    host.platforms.filter((platform) => !platform.available),
  );
  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-3 text-sm">
      {!props.loaded || busy ? (
        <span className="flex items-center gap-2 text-muted-foreground">
          <Spinner className="size-3" />
          Finding simulators and emulators…
        </span>
      ) : null}
      {groups.map((group) => (
        <section key={group.platform} className="flex flex-col gap-1">
          <h3 className="px-1 text-xs font-medium text-muted-foreground">
            {group.platform === "ios" ? "iOS Simulators" : "Android Emulators"}
          </h3>
          {group.devices.map((device) => (
            <button
              key={deviceKey(device)}
              type="button"
              disabled={props.pendingKey !== null}
              className="flex items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-accent disabled:opacity-60"
              onClick={() => props.onPick(device)}
            >
              <span
                className={cn(
                  "size-2 shrink-0 rounded-full",
                  device.booted ? "bg-emerald-500" : "bg-muted-foreground/40",
                )}
              />
              <span className="min-w-0 flex-1 truncate">
                {device.name}
                <span className="text-muted-foreground">
                  {" · "}
                  {device.version}
                  {state.hosts.length > 1 ? ` · ${props.hostLabel(device.hostId)}` : ""}
                </span>
              </span>
              {props.pendingKey === deviceKey(device) ? (
                <Spinner className="size-3" />
              ) : (
                <span className="text-xs text-muted-foreground">
                  {device.booted ? "Open" : "Boot"}
                </span>
              )}
            </button>
          ))}
        </section>
      ))}
      {props.loaded && !busy && !state.devices.some((device) => device.platform === "android") ? (
        <p className="px-1 text-xs text-muted-foreground">
          {unavailable.find((platform) => platform.platform === "android")?.reason ??
            "No Android virtual devices found. Create one in Android Studio's Device Manager, then refresh."}
        </p>
      ) : null}
      {props.loaded && !busy && state.hostStatus === "failed" ? (
        <p className="px-1 text-xs text-destructive">
          {state.hostStatusDetail ?? "The device hub failed to start."}
        </p>
      ) : null}
      <Button className="self-start" size="xs" variant="ghost" onClick={props.onRefresh}>
        <RefreshCwIcon />
        Refresh devices
      </Button>
    </div>
  );
}
