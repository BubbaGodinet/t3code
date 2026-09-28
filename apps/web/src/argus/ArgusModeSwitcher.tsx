import { cn } from "../lib/utils";
import {
  ARGUS_IN_FRAME,
  ARGUS_ORIGIN,
  argusModeTabs,
  runArgusModeAction,
} from "./argusCommandCenter";

const TABS = argusModeTabs({ inFrame: ARGUS_IN_FRAME, argusOrigin: ARGUS_ORIGIN });

/**
 * Argus's Command / Sanctuary switcher, in the banner slot of the command
 * center. Command is this grid; Sanctuary goes to the Argus Sanctuary page.
 */
export function ArgusModeSwitcher({ className }: { className?: string }) {
  return (
    <div
      role="tablist"
      aria-label="ARGUS mode"
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 rounded-full border border-border bg-muted/40 p-0.5 text-[11px] [-webkit-app-region:no-drag]",
        className,
      )}
    >
      {TABS.map((tab) => (
        <button
          key={tab.mode}
          type="button"
          role="tab"
          aria-selected={tab.selected}
          className={cn(
            "cursor-pointer rounded-full px-2.5 py-0.5 font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
            tab.selected
              ? "bg-accent text-foreground shadow-xs"
              : "text-muted-foreground hover:bg-accent/60 hover:text-foreground active:bg-accent",
          )}
          onClick={() => runArgusModeAction(tab.action)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
