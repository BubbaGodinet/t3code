import { createFileRoute } from "@tanstack/react-router";

import { SidebarInset } from "../components/ui/sidebar";
import { WorkspacePageHeader } from "../components/WorkspacePageHeader";
import { isElectron } from "../env";

/** Argus Sanctuary inside the app window, for desktop and unframed web. Blank for now. */
function SanctuaryRouteView() {
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        <WorkspacePageHeader electron={isElectron} />
        <main className="flex min-h-0 flex-1 items-center justify-center p-6">
          <h1 className="text-lg font-medium tracking-tight text-muted-foreground">Sanctuary</h1>
        </main>
      </div>
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/sanctuary")({
  component: SanctuaryRouteView,
});
