import {
  BuildingIcon,
  MessageSquarePlusIcon,
  PictureInPicture2Icon,
  SquareTerminalIcon,
  XIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { Button } from "../../components/ui/button";
import { SidebarInset } from "../../components/ui/sidebar";
import { WorkspacePageHeader } from "../../components/WorkspacePageHeader";
import { isElectron } from "../../env";
import { cn } from "../../lib/utils";
import type { ThreadRouteTarget } from "../../threadRoutes";
import { CompaniesDialog, useCompaniesDialog } from "./CompaniesDialog";
import {
  HOVER_ACTIVATE_DELAY_MS,
  beginMosaicInteraction,
  canHoverActivate,
  createHoverActivator,
  isMosaicInteracting,
  isOverlayOpen,
} from "./hoverActivation";
import { ConfigurationSwitcher, SaveConfigurationButton } from "./MosaicConfigControls";
import { moveFloatRect, resizeFloatRect } from "./mosaicFloat";
import { MosaicPaneView } from "./MosaicPane";
import { routeTargetKey, useMosaicStore } from "./mosaicStore";
import { detachedFloatingPaneIds } from "./mosaicSurfaces";
import { layoutMosaic, type MosaicDivider } from "./mosaicTree";
import { useMosaicActions } from "./useMosaicActions";
import { useMosaicConfigs } from "./useMosaicConfigs";
import { useMosaicLayoutSync } from "./useMosaicLayoutSync";

/** Half the gap between panes, in px; panes inset by this so dividers sit in the gutter. */
const GUTTER = 3;

/**
 * Runs a pointer drag captured on `handle`, reporting movement in container
 * percent. Holds the mosaic interaction so hover activation stays put.
 */
function capturePointerDrag(
  event: ReactPointerEvent<HTMLElement>,
  container: HTMLElement,
  onMove: (dxPercent: number, dyPercent: number, event: PointerEvent) => void,
  onEnd?: (event: PointerEvent) => void,
) {
  event.preventDefault();
  const handle = event.currentTarget;
  handle.setPointerCapture(event.pointerId);
  const release = beginMosaicInteraction();
  const bounds = container.getBoundingClientRect();
  let lastX = event.clientX;
  let lastY = event.clientY;
  const move = (moveEvent: PointerEvent) => {
    const dx = moveEvent.clientX - lastX;
    const dy = moveEvent.clientY - lastY;
    if ((dx === 0 && dy === 0) || bounds.width <= 0 || bounds.height <= 0) return;
    lastX = moveEvent.clientX;
    lastY = moveEvent.clientY;
    onMove((dx / bounds.width) * 100, (dy / bounds.height) * 100, moveEvent);
  };
  const end = (endEvent: PointerEvent) => {
    handle.removeEventListener("pointermove", move);
    handle.removeEventListener("pointerup", end);
    handle.removeEventListener("pointercancel", end);
    release();
    onEnd?.(endEvent);
  };
  handle.addEventListener("pointermove", move);
  handle.addEventListener("pointerup", end);
  handle.addEventListener("pointercancel", end);
}

function DividerHandle({
  divider,
  containerRef,
}: {
  divider: MosaicDivider;
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const resize = useMosaicStore((state) => state.resize);
  const horizontal = divider.direction === "row";
  const { splitRect, position } = divider;

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const container = containerRef.current;
    if (!container) return;
    const splitPercent = horizontal ? splitRect.width : splitRect.height;
    if (splitPercent <= 0) return;
    capturePointerDrag(event, container, (dx, dy) =>
      resize(divider.splitId, divider.index, ((horizontal ? dx : dy) / splitPercent) * 100),
    );
  };

  return (
    <div
      role="separator"
      aria-orientation={horizontal ? "vertical" : "horizontal"}
      className="group absolute z-10 flex touch-none items-center justify-center"
      style={
        horizontal
          ? {
              left: `calc(${position}% - ${GUTTER + 1}px)`,
              top: `${splitRect.y}%`,
              width: GUTTER * 2 + 2,
              height: `${splitRect.height}%`,
              cursor: "col-resize",
            }
          : {
              top: `calc(${position}% - ${GUTTER + 1}px)`,
              left: `${splitRect.x}%`,
              height: GUTTER * 2 + 2,
              width: `${splitRect.width}%`,
              cursor: "row-resize",
            }
      }
      onPointerDown={onPointerDown}
    >
      <span
        className={
          horizontal
            ? "h-8 w-0.5 rounded-full bg-border group-hover:bg-primary"
            : "h-0.5 w-8 rounded-full bg-border group-hover:bg-primary"
        }
      />
    </div>
  );
}

interface PaneDrag {
  readonly sourceId: string;
  readonly overId: string | null;
}

/**
 * Drag from a pane's header grip: a docked pane swaps slots with the pane it
 * is dropped on (found by hit-testing the `data-mosaic-pane-id` slots), while
 * a floating pane moves its window.
 */
function usePaneDrag(containerRef: React.RefObject<HTMLDivElement | null>) {
  const swapPanes = useMosaicStore((state) => state.swapPanes);
  const [drag, setDrag] = useState<PaneDrag | null>(null);

  const startDrag = useCallback(
    (sourceId: string, event: ReactPointerEvent<HTMLElement>) => {
      const container = containerRef.current;
      if (event.button !== 0 || !container) return;
      if (useMosaicStore.getState().floating[sourceId]) {
        capturePointerDrag(event, container, (dx, dy) => {
          const store = useMosaicStore.getState();
          const rect = store.floating[sourceId];
          if (rect) store.setFloatingRect(sourceId, moveFloatRect(rect, dx, dy));
        });
        return;
      }
      let overId: string | null = null;
      setDrag({ sourceId, overId });
      capturePointerDrag(
        event,
        container,
        (_dx, _dy, moveEvent) => {
          const slot = document
            .elementFromPoint(moveEvent.clientX, moveEvent.clientY)
            ?.closest<HTMLElement>("[data-mosaic-pane-id]");
          const next = slot?.dataset.mosaicPaneId ?? null;
          const target = next === sourceId ? null : next;
          if (target === overId) return;
          overId = target;
          setDrag({ sourceId, overId });
        },
        (endEvent) => {
          if (endEvent.type === "pointerup" && overId !== null) swapPanes(sourceId, overId);
          setDrag(null);
        },
      );
    },
    [containerRef, swapPanes],
  );

  return { drag, startDrag };
}

/** Puts typing in the pane's composer or terminal, unless focus sits somewhere outside the grid. */
function moveKeyboardFocusToPane(paneId: string) {
  const paneElement = document.querySelector(`[data-mosaic-pane="${CSS.escape(paneId)}"]`);
  if (!paneElement) return;
  const current = document.activeElement;
  if (current && paneElement.contains(current)) return;
  if (current && current !== document.body && !current.closest("[data-mosaic-pane]")) return;
  paneElement
    .querySelector<HTMLElement>('[data-testid="composer-editor"], .xterm-helper-textarea')
    ?.focus({ preventScroll: true });
}

/** Focus follows the pointer across panes, per the guards in `hoverActivation`. */
function useHoverActivation() {
  const { focusPane } = useMosaicActions();
  const activate = useEffectEvent((paneId: string) => {
    focusPane(paneId);
    moveKeyboardFocusToPane(paneId);
  });
  const activatorRef = useRef<ReturnType<typeof createHoverActivator> | null>(null);

  useEffect(() => {
    const activator = createHoverActivator({
      delayMs: HOVER_ACTIVATE_DELAY_MS,
      canActivate: (paneId) =>
        canHoverActivate({
          buttons: 0,
          interacting: isMosaicInteracting(),
          overlayOpen: isOverlayOpen(),
          alreadyActive: useMosaicStore.getState().activePaneId === paneId,
        }),
      activate: (paneId) => activate(paneId),
    });
    activatorRef.current = activator;
    return () => {
      activator.cancel();
      activatorRef.current = null;
    };
  }, []);

  return useMemo(
    () => ({
      onPointerMove: (paneId: string, event: ReactPointerEvent<HTMLElement>) =>
        activatorRef.current?.hover(paneId, event.buttons),
      onPointerLeave: (paneId: string) => activatorRef.current?.leave(paneId),
    }),
    [],
  );
}

/**
 * The pane mosaic that replaces the single chat view while enabled. Panes are
 * absolutely positioned from the split tree so reshaping the layout, or
 * popping a pane out to float, moves a chat without remounting it.
 */
export function ChatMosaic({ routeTarget }: { routeTarget: ThreadRouteTarget }) {
  const root = useMosaicStore((state) => state.root);
  const floating = useMosaicStore((state) => state.floating);
  const activePaneId = useMosaicStore((state) => state.activePaneId);
  const addPane = useMosaicStore((state) => state.addPane);
  const setEnabled = useMosaicStore((state) => state.setEnabled);
  const openCompanies = useCompaniesDialog((state) => state.setOpen);
  const containerRef = useRef<HTMLDivElement>(null);
  const layout = useMemo(() => layoutMosaic(root), [root]);
  const { drag, startDrag } = usePaneDrag(containerRef);
  const hover = useHoverActivation();
  useMosaicLayoutSync(routeTarget);
  const { configs, ready, saveConfig, loadConfig } = useMosaicConfigs();

  const panes = useMosaicStore((state) => state.panes);
  const shownPanes = useMemo(
    () => [
      ...layout.panes,
      ...detachedFloatingPaneIds({ panes, root, floating }).map((paneId) => ({
        paneId,
        rect: floating[paneId]!,
      })),
    ],
    [floating, layout, panes, root],
  );

  const toggleFloat = useCallback(
    (paneId: string) => {
      const store = useMosaicStore.getState();
      if (store.floating[paneId]) {
        store.dockFloating(paneId);
        return;
      }
      const slot = layout.panes.find((entry) => entry.paneId === paneId)?.rect;
      if (slot) store.toggleFloating(paneId, slot);
    },
    [layout],
  );

  const startFloatResize = (paneId: string, event: ReactPointerEvent<HTMLElement>) => {
    const container = containerRef.current;
    if (event.button !== 0 || !container) return;
    event.stopPropagation();
    capturePointerDrag(event, container, (dx, dy) => {
      const store = useMosaicStore.getState();
      const rect = store.floating[paneId];
      if (rect) store.setFloatingRect(paneId, resizeFloatRect(rect, dx, dy));
    });
  };

  const routeKey = routeTargetKey(routeTarget);
  const lastRouteKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (lastRouteKeyRef.current === routeKey) return;
    const mode = lastRouteKeyRef.current === null ? "enter" : "navigate";
    lastRouteKeyRef.current = routeKey;
    useMosaicStore.getState().syncRouteTarget(routeTarget, mode);
  }, [routeKey, routeTarget]);

  return (
    <SidebarInset className="h-svh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground md:h-dvh">
      <WorkspacePageHeader electron={isElectron} className="gap-2">
        <div className="flex flex-1 items-center gap-1 [-webkit-app-region:no-drag]">
          <Button size="xs" variant="outline" onClick={() => addPane("chat")}>
            <MessageSquarePlusIcon />
            Chat
          </Button>
          <Button
            size="xs"
            variant="outline"
            onClick={() => addPane("terminal", { direction: "column" })}
          >
            <SquareTerminalIcon />
            Terminal
          </Button>
          <Button size="xs" variant="ghost-muted" onClick={() => openCompanies(true)}>
            <BuildingIcon />
            Companies
          </Button>
        </div>
        <div className="flex items-center gap-1 [-webkit-app-region:no-drag]">
          <ConfigurationSwitcher configs={configs} loadConfig={loadConfig} />
          <SaveConfigurationButton configs={configs} ready={ready} saveConfig={saveConfig} />
          <Button size="xs" variant="ghost-muted" onClick={() => setEnabled(false)}>
            <XIcon />
            Exit grid
          </Button>
        </div>
      </WorkspacePageHeader>
      <div className="relative min-h-0 flex-1 overflow-hidden p-[3px]">
        <div
          ref={containerRef}
          className={cn("relative h-full w-full", drag && "cursor-grabbing select-none")}
        >
          {shownPanes.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Empty grid. Add a chat or terminal pane.
            </div>
          ) : null}
          {layout.panes.map(({ paneId, rect }) =>
            floating[paneId] ? (
              <div
                key={`slot:${paneId}`}
                data-mosaic-pane-id={paneId}
                className="absolute"
                style={{
                  left: `${rect.x}%`,
                  top: `${rect.y}%`,
                  width: `${rect.width}%`,
                  height: `${rect.height}%`,
                  padding: GUTTER,
                }}
              >
                <div className="flex h-full items-start justify-center gap-2 rounded-lg border border-dashed border-border p-2 text-xs text-muted-foreground">
                  <span className="py-0.5">Popped out</span>
                  <Button size="xs" variant="outline" onClick={() => toggleFloat(paneId)}>
                    <PictureInPicture2Icon />
                    Dock
                  </Button>
                </div>
                {drag?.overId === paneId ? (
                  <div
                    className="pointer-events-none absolute z-20 rounded-lg border-2 border-dashed border-primary bg-primary/10"
                    style={{ inset: GUTTER }}
                  />
                ) : null}
              </div>
            ) : null,
          )}
          {shownPanes.map(({ paneId, rect }) => {
            const float = floating[paneId];
            const box = float ?? rect;
            return (
              <div
                key={paneId}
                data-mosaic-pane={paneId}
                {...(float ? {} : { "data-mosaic-pane-id": paneId })}
                className={cn(
                  "absolute",
                  float && "rounded-lg shadow-2xl",
                  float && (paneId === activePaneId ? "z-40" : "z-30"),
                  drag?.sourceId === paneId && "opacity-60",
                )}
                style={{
                  left: `${box.x}%`,
                  top: `${box.y}%`,
                  width: `${box.width}%`,
                  height: `${box.height}%`,
                  padding: float ? 0 : GUTTER,
                }}
                onPointerMove={(event) => hover.onPointerMove(paneId, event)}
                onPointerLeave={() => hover.onPointerLeave(paneId)}
              >
                <MosaicPaneView
                  paneId={paneId}
                  active={paneId === activePaneId}
                  floating={float !== undefined}
                  onStartDrag={startDrag}
                  onToggleFloat={toggleFloat}
                />
                {float ? (
                  <div
                    role="separator"
                    aria-label="Resize floating pane"
                    className="absolute right-0 bottom-0 z-10 size-3.5 cursor-nwse-resize touch-none"
                    onPointerDown={(event) => startFloatResize(paneId, event)}
                  />
                ) : null}
                {drag?.overId === paneId ? (
                  <div
                    className="pointer-events-none absolute z-20 rounded-lg border-2 border-dashed border-primary bg-primary/10"
                    style={{ inset: GUTTER }}
                  />
                ) : null}
              </div>
            );
          })}
          {layout.dividers.map((divider) => (
            <DividerHandle
              key={`${divider.splitId}:${divider.index}`}
              divider={divider}
              containerRef={containerRef}
            />
          ))}
        </div>
      </div>
      <CompaniesDialog />
    </SidebarInset>
  );
}
