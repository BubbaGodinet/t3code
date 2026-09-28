import { BuildingIcon, MessageSquarePlusIcon, SquareTerminalIcon, XIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
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
import { MosaicPaneView } from "./MosaicPane";
import { routeTargetKey, useMosaicStore } from "./mosaicStore";
import { layoutMosaic, type MosaicDivider, type MosaicPreset } from "./mosaicTree";
import { useMosaicLayoutSync } from "./useMosaicLayoutSync";

const PRESETS: ReadonlyArray<{ preset: MosaicPreset; label: string; title: string }> = [
  { preset: "row", label: "Row", title: "All panes side by side" },
  { preset: "two-over-one", label: "2+1", title: "Two on top, one across the bottom" },
  { preset: "grid-2x2", label: "2×2", title: "Two by two" },
  { preset: "three-over-two", label: "3+2", title: "Three on top, two below" },
];

/** Half the gap between panes, in px; panes inset by this so dividers sit in the gutter. */
const GUTTER = 3;

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
    event.preventDefault();
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const bounds = container.getBoundingClientRect();
    const splitPx = horizontal
      ? (bounds.width * splitRect.width) / 100
      : (bounds.height * splitRect.height) / 100;
    let last = horizontal ? event.clientX : event.clientY;
    const onMove = (moveEvent: PointerEvent) => {
      const current = horizontal ? moveEvent.clientX : moveEvent.clientY;
      const delta = current - last;
      if (delta === 0 || splitPx <= 0) return;
      last = current;
      resize(divider.splitId, divider.index, (delta / splitPx) * 100);
    };
    const onUp = () => {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      target.removeEventListener("pointercancel", onUp);
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
    target.addEventListener("pointercancel", onUp);
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
 * Drag-to-swap from a pane's header grip. The pointer is captured on the grip,
 * so the pane under it is found by hit-testing the `data-mosaic-pane-id` slots.
 */
function usePaneDrag() {
  const swapPanes = useMosaicStore((state) => state.swapPanes);
  const [drag, setDrag] = useState<PaneDrag | null>(null);

  const startDrag = useCallback(
    (sourceId: string, event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const handle = event.currentTarget;
      handle.setPointerCapture(event.pointerId);
      let overId: string | null = null;
      setDrag({ sourceId, overId });
      const onMove = (moveEvent: PointerEvent) => {
        const slot = document
          .elementFromPoint(moveEvent.clientX, moveEvent.clientY)
          ?.closest<HTMLElement>("[data-mosaic-pane-id]");
        const next = slot?.dataset.mosaicPaneId ?? null;
        const target = next === sourceId ? null : next;
        if (target === overId) return;
        overId = target;
        setDrag({ sourceId, overId });
      };
      const onEnd = (endEvent: PointerEvent) => {
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onEnd);
        handle.removeEventListener("pointercancel", onEnd);
        if (endEvent.type === "pointerup" && overId !== null) swapPanes(sourceId, overId);
        setDrag(null);
      };
      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onEnd);
      handle.addEventListener("pointercancel", onEnd);
    },
    [swapPanes],
  );

  return { drag, startDrag };
}

/**
 * The pane mosaic that replaces the single chat view while enabled. Panes are
 * absolutely positioned from the split tree so reshaping the layout moves a
 * chat without remounting it.
 */
export function ChatMosaic({ routeTarget }: { routeTarget: ThreadRouteTarget }) {
  const root = useMosaicStore((state) => state.root);
  const activePaneId = useMosaicStore((state) => state.activePaneId);
  const applyPreset = useMosaicStore((state) => state.applyPreset);
  const addPane = useMosaicStore((state) => state.addPane);
  const setEnabled = useMosaicStore((state) => state.setEnabled);
  const openCompanies = useCompaniesDialog((state) => state.setOpen);
  const containerRef = useRef<HTMLDivElement>(null);
  const layout = useMemo(() => layoutMosaic(root), [root]);
  const { drag, startDrag } = usePaneDrag();
  useMosaicLayoutSync(routeTarget);

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
        <div className="flex items-center gap-0.5 [-webkit-app-region:no-drag]">
          {PRESETS.map(({ preset, label, title }) => (
            <Button
              key={preset}
              size="xs"
              variant="ghost-muted"
              title={title}
              aria-label={title}
              onClick={() => applyPreset(preset)}
            >
              {label}
            </Button>
          ))}
        </div>
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
        <Button
          className="[-webkit-app-region:no-drag]"
          size="xs"
          variant="ghost-muted"
          onClick={() => setEnabled(false)}
        >
          <XIcon />
          Exit grid
        </Button>
      </WorkspacePageHeader>
      <div className="relative min-h-0 flex-1 overflow-hidden p-[3px]">
        <div
          ref={containerRef}
          className={cn("relative h-full w-full", drag && "cursor-grabbing select-none")}
        >
          {layout.panes.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Empty grid. Add a chat or terminal pane, or pick a layout.
            </div>
          ) : null}
          {layout.panes.map(({ paneId, rect }) => (
            <div
              key={paneId}
              data-mosaic-pane-id={paneId}
              className={cn("absolute", drag?.sourceId === paneId && "opacity-60")}
              style={{
                left: `${rect.x}%`,
                top: `${rect.y}%`,
                width: `${rect.width}%`,
                height: `${rect.height}%`,
                padding: GUTTER,
              }}
            >
              <MosaicPaneView
                paneId={paneId}
                active={paneId === activePaneId}
                onStartDrag={startDrag}
              />
              {drag?.overId === paneId ? (
                <div
                  className="pointer-events-none absolute z-20 rounded-lg border-2 border-dashed border-primary bg-primary/10"
                  style={{ inset: GUTTER }}
                />
              ) : null}
            </div>
          ))}
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
