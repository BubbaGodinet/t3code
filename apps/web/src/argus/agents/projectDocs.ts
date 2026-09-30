import { PROJECT_MARKDOWN_SKIP_DIRECTORIES, type ProjectEntry } from "@t3tools/contracts";

export interface ProjectDoc {
  readonly path: string;
  readonly title: string;
  readonly mtimeMs: number | null;
}

const MARKDOWN_FILE = /\.(?:md|markdown)$/i;
const INDEX_STEM = /^(?:readme|index)$/i;

function humanize(name: string): string {
  return name.replace(/[-_]+/g, " ").trim() || name;
}

/** The file name without its extension; a README or index takes its folder's name. */
export function projectDocTitle(path: string): string {
  const segments = path.split("/");
  const stem = (segments.at(-1) ?? path).replace(MARKDOWN_FILE, "");
  const folder = segments.at(-2);
  return humanize(INDEX_STEM.test(stem) && folder ? folder : stem);
}

/**
 * The project's markdown files, most recently modified first. Dependency and
 * build trees stay out; note folders such as `.notes` stay in.
 */
export function selectProjectDocs(entries: ReadonlyArray<ProjectEntry>): ProjectDoc[] {
  const docs: ProjectDoc[] = [];
  for (const entry of entries) {
    if (entry.kind !== "file" || !MARKDOWN_FILE.test(entry.path)) continue;
    const folders = entry.path.split("/").slice(0, -1);
    if (folders.some((folder) => PROJECT_MARKDOWN_SKIP_DIRECTORIES.has(folder))) continue;
    docs.push({
      path: entry.path,
      title: projectDocTitle(entry.path),
      mtimeMs: entry.mtimeMs ?? null,
    });
  }
  return docs.toSorted(
    (left, right) =>
      (right.mtimeMs ?? -1) - (left.mtimeMs ?? -1) || left.path.localeCompare(right.path),
  );
}

/** Keeps docs whose path or title contains every word of the query. */
export function filterProjectDocs(
  docs: ReadonlyArray<ProjectDoc>,
  query: string,
): ReadonlyArray<ProjectDoc> {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return docs;
  return docs.filter((doc) => {
    const haystack = `${doc.path} ${doc.title}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}
