import { useLocation, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";

import { cn } from "../lib/utils";
import {
  ARGUS_IN_FRAME,
  ARGUS_ORIGIN,
  type ArgusMode,
  type ArgusModeTab,
  argusModeTabs,
  runArgusModeAction,
  useArgusMode,
} from "./argusCommandCenter";
import {
  ARGUS_PILL_SLIDE_MS,
  argusModeTransition,
  prefersReducedMotion,
  runArgusModeTransition,
} from "./argusModeTransition";

/**
 * The Command / Sanctuary pill, fixed at the top center of the window in both
 * modes. The root renders it beside the route outlet, so it stays mounted and
 * in place while the spaces beneath it swap.
 */
export function ArgusModePillHost() {
  const current = useArgusMode();
  if (!current) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-40 flex h-[var(--workspace-topbar-height)] items-center justify-center">
      <ArgusModeSwitcher current={current} className="pointer-events-auto" />
    </div>
  );
}

/**
 * Command is the pane grid; Sanctuary is the framing Argus window's page, or
 * the in-app Sanctuary space when nothing frames T3. Picking a side slides the
 * knob first, then the space changes: Command melts onto Sanctuary, Sanctuary
 * splits open onto Command.
 */
function ArgusModeSwitcher({ current, className }: { current: ArgusMode; className?: string }) {
  const currentHref = useLocation({ select: (location) => location.href });
  const navigate = useNavigate();
  // The side picked while the knob slides and the space changes; stale once the mode moves on.
  const [picked, setPicked] = useState<{ from: ArgusMode; to: ArgusMode } | null>(null);
  const switching = useRef(false);
  const shown = picked?.from === current ? picked.to : current;
  const tabs = argusModeTabs({
    inFrame: ARGUS_IN_FRAME,
    argusOrigin: ARGUS_ORIGIN,
    current: shown,
  });

  const pick = (tab: ArgusModeTab) => {
    if (tab.mode === shown || switching.current) return;
    setPicked({ from: current, to: tab.mode });
    const transition = tab.action.kind === "frame" ? null : argusModeTransition(current, tab.mode);
    if (!transition || prefersReducedMotion()) {
      runArgusModeAction(tab.action, { currentHref, navigate: (href) => void navigate({ href }) });
      return;
    }
    switching.current = true;
    window.setTimeout(() => {
      void runArgusModeTransition(transition, tab.mode, async () => {
        let navigation: Promise<void> | undefined;
        runArgusModeAction(tab.action, {
          currentHref,
          navigate: (href) => {
            navigation = navigate({ href });
          },
        });
        await navigation;
      }).finally(() => {
        switching.current = false;
      });
    }, ARGUS_PILL_SLIDE_MS);
  };

  return (
    <div
      role="tablist"
      aria-label="ARGUS mode"
      className={cn(
        "argus-mode-pill relative inline-grid shrink-0 grid-cols-2 items-center rounded-full border border-border bg-muted/40 p-0.5 text-[11px] backdrop-blur-sm [-webkit-app-region:no-drag]",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute inset-y-0.5 left-0.5 w-[calc(50%-2px)] rounded-full bg-accent shadow-xs transition-transform duration-200 ease-out motion-reduce:transition-none",
          shown === "sanctuary" && "translate-x-full",
        )}
      />
      {tabs.map((tab) => (
        <button
          key={tab.mode}
          type="button"
          role="tab"
          aria-selected={tab.selected}
          className={cn(
            "relative cursor-pointer rounded-full px-2.5 py-0.5 text-center font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
            tab.selected ? "text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
          onClick={() => pick(tab)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
