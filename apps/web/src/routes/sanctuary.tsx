import { createFileRoute, redirect } from "@tanstack/react-router";

import { ARGUS_SANCTUARY_SPACE_ATTRIBUTE } from "../argus/argusModeTransition";
import { isElectron } from "../env";
import { cn } from "../lib/utils";

/**
 * Argus Sanctuary inside the app window, for desktop and unframed web. Its own
 * full-window space outside the command shell: no sidebar, no work chrome. The
 * root's mode pill floats above it. Blank for now, drawn as two halves so it
 * can split down the middle when leaving for Command.
 */
function SanctuaryRouteView() {
  return (
    <div
      {...{ [ARGUS_SANCTUARY_SPACE_ATTRIBUTE]: "" }}
      className="relative h-dvh min-h-0 w-full overflow-hidden overscroll-y-none bg-background text-foreground isolate"
    >
      <div
        aria-hidden
        className="argus-sanctuary-left absolute inset-y-0 left-0 w-1/2 bg-background"
      />
      <div
        aria-hidden
        className="argus-sanctuary-right absolute inset-y-0 right-0 w-1/2 bg-background"
      />
      <header
        className={cn(
          "relative h-[var(--workspace-topbar-height)] min-h-[var(--workspace-topbar-height)]",
          isElectron && "drag-region",
        )}
      />
    </div>
  );
}

export const Route = createFileRoute("/sanctuary")({
  beforeLoad: async ({ context }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    ) {
      throw redirect({ to: "/pair", replace: true });
    }
  },
  component: SanctuaryRouteView,
});
