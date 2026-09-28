import type { ReactNode } from "react";

import { APP_DISPLAY_NAME } from "../../branding";
import { StudioMark } from "../StudioMark";
import { StandalonePage } from "../ui/standalone-page";

/**
 * Branded masthead for the CLI-connect authorize and callback pages.
 */
export function AuthSurfaceShell({ children }: { readonly children: ReactNode }) {
  return (
    <StandalonePage
      tone="brand"
      masthead={
        <header className="relative h-24 overflow-hidden bg-[#0b0d12] text-[#eceef3]">
          <div
            aria-hidden
            className="absolute inset-0 bg-[radial-gradient(circle_at_75%_25%,rgba(101,50,240,0.4),transparent_45%)]"
          />
          <div className="relative h-full p-5 sm:p-6">
            <div className="flex items-center gap-2">
              <StudioMark brand aria-hidden className="h-3.5 w-auto shrink-0" />
              <p className="text-[10px] font-semibold tracking-[0.2em] text-white/80 uppercase">
                {APP_DISPLAY_NAME}
              </p>
            </div>
          </div>
        </header>
      }
    >
      {children}
    </StandalonePage>
  );
}
