import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";

import type { MosaicCompany, MosaicPane } from "./mosaicStore";

export const RECENT_THREAD_LIMIT = 12;

/** Enough of a thread to decide which company it belongs to and how recent it is. */
export interface RecentThreadRef {
  readonly environmentId: EnvironmentId;
  readonly id: ThreadId;
  readonly projectId: ProjectId;
  readonly updatedAt: string;
  readonly archivedAt: string | null;
}

export interface RecentThreadSection<T> {
  readonly id: string;
  readonly company: MosaicCompany | null;
  readonly threads: ReadonlyArray<T>;
}

const OTHER_SECTION_ID = "other";
const OTHER_BUCKET = "\0other";

function sameProject(
  company: MosaicCompany,
  environmentId: EnvironmentId,
  projectId: ProjectId,
): boolean {
  const projectRef = company.projectRef;
  return (
    projectRef !== null &&
    projectRef.environmentId === environmentId &&
    projectRef.projectId === projectId
  );
}

/** The server chat a pane is showing. Terminal sessions are not user threads. */
function paneThreadRef(
  pane: MosaicPane,
): { readonly environmentId: EnvironmentId; readonly threadId: ThreadId } | null {
  if (pane.kind === "chat") {
    return pane.target?.kind === "server" ? pane.target.threadRef : null;
  }
  if ((pane.kind === "browser" || pane.kind === "device") && pane.source?.kind === "thread") {
    return pane.source.threadRef;
  }
  return null;
}

/**
 * Company for one recent thread.
 * The company whose repository contains the thread wins. If no company owns
 * that project, the thread belongs to a company already bound to a pane that
 * shows it. Otherwise it matches no company.
 */
export function companyForThread(
  thread: Pick<RecentThreadRef, "environmentId" | "id" | "projectId">,
  companies: ReadonlyArray<MosaicCompany>,
  panes: ReadonlyArray<MosaicPane>,
): MosaicCompany | null {
  const byProject = companies.find((company) =>
    sameProject(company, thread.environmentId, thread.projectId),
  );
  if (byProject) return byProject;

  for (const pane of panes) {
    const shown = paneThreadRef(pane);
    if (
      !shown ||
      shown.environmentId !== thread.environmentId ||
      shown.threadId !== thread.id ||
      !pane.companyId
    ) {
      continue;
    }
    const bound = companies.find((company) => company.id === pane.companyId);
    if (bound) return bound;
  }
  return null;
}

/**
 * Newest non-archived threads, split under their companies. Sections follow
 * the company list, then Other. Companies with nothing in this window are omitted.
 */
export function groupRecentThreads<T extends RecentThreadRef>(
  threads: ReadonlyArray<T>,
  companies: ReadonlyArray<MosaicCompany>,
  panes: ReadonlyArray<MosaicPane>,
  limit = RECENT_THREAD_LIMIT,
): ReadonlyArray<RecentThreadSection<T>> {
  const recent = threads
    .filter((thread) => thread.archivedAt === null)
    .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, limit);

  const buckets = new Map<string, T[]>();
  for (const thread of recent) {
    const company = companyForThread(thread, companies, panes);
    const bucket = company?.id ?? OTHER_BUCKET;
    const existing = buckets.get(bucket);
    if (existing) existing.push(thread);
    else buckets.set(bucket, [thread]);
  }

  const sections: RecentThreadSection<T>[] = [];
  for (const company of companies) {
    const sectionThreads = buckets.get(company.id);
    if (!sectionThreads || sectionThreads.length === 0) continue;
    sections.push({ id: company.id, company, threads: sectionThreads });
  }
  const other = buckets.get(OTHER_BUCKET);
  if (other && other.length > 0) {
    sections.push({ id: OTHER_SECTION_ID, company: null, threads: other });
  }
  return sections;
}
