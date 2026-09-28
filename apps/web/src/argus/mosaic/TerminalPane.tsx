import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { ThreadId } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { TerminalViewport } from "../../components/ThreadTerminalDrawer";
import { Button } from "../../components/ui/button";
import { useProject } from "../../state/entities";
import { primaryServerKeybindingsAtom } from "../../state/server";
import type { MosaicCompany, MosaicPane } from "./mosaicStore";

type TerminalMosaicPane = Extract<MosaicPane, { kind: "terminal" }>;

/**
 * A project terminal that belongs to no thread. The server keys terminal
 * sessions by an opaque thread id, so the pane supplies its own.
 */
export function TerminalPane({
  pane,
  company,
  active,
}: {
  pane: TerminalMosaicPane;
  company: MosaicCompany;
  active: boolean;
}) {
  const project = useProject(company.projectRef);
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ epoch: 0, height: 0 });
  const [generation, setGeneration] = useState(0);
  const [exited, setExited] = useState(false);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    let frame: number | null = null;
    const observer = new ResizeObserver(() => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        setSize((previous) => ({ epoch: previous.epoch + 1, height: node.clientHeight }));
      });
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, []);

  const threadRef = useMemo(
    () =>
      company.projectRef
        ? scopeThreadRef(company.projectRef.environmentId, ThreadId.make(pane.sessionThreadId))
        : null,
    [company.projectRef, pane.sessionThreadId],
  );

  return (
    <div ref={containerRef} className="relative h-full min-h-0 w-full">
      {threadRef && project ? (
        exited ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
            Terminal exited.
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setExited(false);
                setGeneration((value) => value + 1);
              }}
            >
              Restart
            </Button>
          </div>
        ) : (
          <TerminalViewport
            key={generation}
            advancedTypography={false}
            threadRef={threadRef}
            threadId={threadRef.threadId}
            terminalId={pane.terminalId}
            terminalLabel={`${company.name} terminal`}
            cwd={project.workspaceRoot}
            onSessionExited={() => setExited(true)}
            focusRequestId={0}
            autoFocus={active}
            visible
            resizeEpoch={size.epoch}
            drawerHeight={size.height}
            keybindings={keybindings}
          />
        )
      ) : (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          Loading {company.name} repository…
        </div>
      )}
    </div>
  );
}
