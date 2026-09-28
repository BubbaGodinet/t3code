import { createFileRoute, redirect } from "@tanstack/react-router";

import { ArgusModeSwitcher } from "../argus/ArgusModeSwitcher";
import { isElectron } from "../env";
import { cn } from "../lib/utils";

/**
 * Argus Sanctuary inside the app window, for desktop and unframed web. Its own
 * full-window space outside the command shell: no sidebar, no work chrome, only
 * the switcher back to Command. Blank for now.
 */
function SanctuaryRouteView() {
  return (
    <div className="flex h-dvh min-h-0 w-full flex-col overflow-hidden overscroll-y-none bg-background text-foreground isolate">
      <header
        className={cn(
          "flex h-[var(--workspace-topbar-height)] min-h-[var(--workspace-topbar-height)] shrink-0 items-center justify-center px-3",
          isElectron && "drag-region",
        )}
      >
        <ArgusModeSwitcher />
      </header>
      <main className="min-h-0 flex-1" />
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
