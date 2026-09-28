import { cn } from "../lib/utils";
import { ARGUS_HAS_PARENT, selectArgusMode } from "./argusCommandCenter";

/**
 * Argus's Command / Sanctuary switcher, in the banner slot of the command
 * center. Command is this grid; Sanctuary is an Argus page, so the framing
 * window navigates. Without a framing window there is nowhere to go.
 */
export function ArgusModeSwitcher({ className }: { className?: string }) {
  return (
    <div
      role="tablist"
      aria-label="ARGUS mode"
      className={cn(
        "inline-flex shrink-0 rounded-full border border-border bg-muted/40 p-0.5 text-[11px] [-webkit-app-region:no-drag]",
        className,
      )}
    >
      <button
        type="button"
        role="tab"
        aria-selected
        className="rounded-full bg-accent px-2.5 py-0.5 font-medium text-foreground"
      >
        Command
      </button>
      {ARGUS_HAS_PARENT ? (
        <button
          type="button"
          role="tab"
          aria-selected={false}
          className="rounded-full px-2.5 py-0.5 font-medium text-muted-foreground hover:text-foreground"
          onClick={() => selectArgusMode("sanctuary")}
        >
          Sanctuary
        </button>
      ) : null}
    </div>
  );
}
