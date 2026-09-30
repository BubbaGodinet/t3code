import type { EnvironmentId } from "@t3tools/contracts";

import { useProjectFileQuery } from "../../components/files/projectFilesQueryState";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { ChatFocusDialog } from "./ChatAgentsBar";
import { FocusMarkdown } from "./FocusMarkdown";
import { projectDocTitle } from "./projectDocs";

/**
 * The Docs focus modal: rendered markdown on a light sheet, over a darkened
 * blurred backdrop. Escape and a click outside close it.
 */
export function ProjectDocFocus({
  environmentId,
  cwd,
  path,
  mtimeMs = null,
  onClose,
}: {
  environmentId: EnvironmentId;
  cwd: string;
  path: string;
  mtimeMs?: number | null;
  onClose: () => void;
}) {
  const file = useProjectFileQuery(environmentId, cwd, path);
  const modified =
    mtimeMs === null ? null : formatRelativeTimeLabel(new Date(mtimeMs).toISOString());
  return (
    <ChatFocusDialog
      title={projectDocTitle(path)}
      meta={
        <>
          <span className="min-w-0 truncate font-mono">{path}</span>
          {modified ? <span className="ms-auto shrink-0">Edited {modified}</span> : null}
        </>
      }
      onClose={onClose}
    >
      {file.data ? (
        <>
          <FocusMarkdown text={file.data.contents} />
          {file.data.truncated ? (
            <p className="border-t pt-3 text-xs text-muted-foreground">
              This doc is longer than the preview limit; the rest is not shown.
            </p>
          ) : null}
        </>
      ) : file.error ? (
        <p className="text-sm text-destructive">{file.error}</p>
      ) : (
        <p className="text-sm text-muted-foreground">Loading…</p>
      )}
    </ChatFocusDialog>
  );
}
