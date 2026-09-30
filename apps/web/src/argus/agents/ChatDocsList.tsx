import type { EnvironmentId } from "@t3tools/contracts";
import { SearchIcon } from "lucide-react";
import { memo, useMemo, useState } from "react";

import { useProjectEntriesQuery } from "../../components/files/projectFilesQueryState";
import { cn } from "../../lib/utils";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { ChatSurfaceHeader } from "./ChatAgentsBar";
import { SCAN_TITLE_CLASS } from "./FocusMarkdown";
import { ProjectDocFocus } from "./ProjectDocFocus";
import { filterProjectDocs, selectProjectDocs, type ProjectDoc } from "./projectDocs";

function modifiedLabel(doc: ProjectDoc): string | null {
  return doc.mtimeMs === null ? null : formatRelativeTimeLabel(new Date(doc.mtimeMs).toISOString());
}

function ChatDocDialog({
  environmentId,
  cwd,
  doc,
  onClose,
}: {
  environmentId: EnvironmentId;
  cwd: string;
  doc: ProjectDoc;
  onClose: () => void;
}) {
  return (
    <ProjectDocFocus
      environmentId={environmentId}
      cwd={cwd}
      path={doc.path}
      mtimeMs={doc.mtimeMs}
      onClose={onClose}
    />
  );
}

/**
 * The markdown docs in the chat's project, most recently modified first, with
 * a search over path and title. A doc opens in the focus modal.
 */
export const ChatDocsList = memo(function ChatDocsList({
  environmentId,
  cwd,
  onDismiss,
}: {
  environmentId: EnvironmentId;
  cwd: string;
  onDismiss: () => void;
}) {
  const entries = useProjectEntriesQuery(environmentId, cwd, undefined, { markdown: true });
  const docs = useMemo(() => selectProjectDocs(entries.data?.entries ?? []), [entries.data]);
  const [query, setQuery] = useState("");
  const shown = useMemo(() => filterProjectDocs(docs, query), [docs, query]);
  const [openPath, setOpenPath] = useState<string | null>(null);
  const openDoc = openPath === null ? null : docs.find((doc) => doc.path === openPath);
  const status = entries.data
    ? shown.length === 0
      ? docs.length === 0
        ? "No markdown docs in this project."
        : "No docs match."
      : null
    : entries.error
      ? entries.error
      : "Loading docs…";

  return (
    <>
      <ChatSurfaceHeader title="Docs">
        <label className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md border border-border/70 bg-background px-2 py-1">
          <SearchIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            type="search"
            value={query}
            placeholder="Search by path or title"
            aria-label="Search docs"
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && shown[0]) setOpenPath(shown[0].path);
            }}
          />
        </label>
        <span className="shrink-0 text-muted-foreground">
          {query.trim() ? `${shown.length} of ${docs.length}` : docs.length}
        </span>
      </ChatSurfaceHeader>
      {status ? (
        <p className="px-3 py-6 text-center text-sm text-muted-foreground">{status}</p>
      ) : (
        <ul className="min-h-0 flex-1 divide-y divide-border/60 overflow-y-auto">
          {shown.map((doc) => {
            const modified = modifiedLabel(doc);
            return (
              <li key={doc.path}>
                <button
                  type="button"
                  aria-haspopup="dialog"
                  className="flex w-full min-w-0 items-start gap-3 px-3 py-3 text-left hover:bg-accent/60"
                  onClick={() => setOpenPath(doc.path)}
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className={cn(SCAN_TITLE_CLASS, "line-clamp-2")}>{doc.title}</span>
                    <span className="truncate font-mono text-xs text-muted-foreground">
                      {doc.path}
                    </span>
                  </span>
                  {modified ? (
                    <span className="shrink-0 text-xs text-muted-foreground">{modified}</span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {openDoc ? (
        <ChatDocDialog environmentId={environmentId} cwd={cwd} doc={openDoc} onClose={onDismiss} />
      ) : null}
    </>
  );
});
