import type { ProjectEntry } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { filterProjectDocs, projectDocTitle, selectProjectDocs } from "./projectDocs";

const file = (path: string, mtimeMs?: number, ignored?: boolean): ProjectEntry => ({
  path,
  kind: "file",
  ...(mtimeMs !== undefined ? { mtimeMs } : {}),
  ...(ignored ? { ignored } : {}),
});

describe("selectProjectDocs", () => {
  it("keeps the project's markdown files, most recently modified first", () => {
    const docs = selectProjectDocs([
      file("README.md", 100),
      { path: "docs", kind: "directory" },
      file("docs/argus/T3-CONNECT.md", 300),
      file("docs/guide.markdown", 200),
      file("src/index.ts", 900),
      file("docs/untimed.md"),
    ]);
    expect(docs.map((doc) => doc.path)).toEqual([
      "docs/argus/T3-CONNECT.md",
      "docs/guide.markdown",
      "README.md",
      "docs/untimed.md",
    ]);
  });

  it("leaves out vendored, tool, and ignored files", () => {
    const docs = selectProjectDocs([
      file(".repos/effect/README.md", 500),
      file(".github/pull_request_template.md", 500),
      file("node_modules/pkg/README.md", 500),
      file("notes/scratch.md", 500, true),
      file("CONTRIBUTING.md", 1),
    ]);
    expect(docs.map((doc) => doc.path)).toEqual(["CONTRIBUTING.md"]);
  });
});

describe("projectDocTitle", () => {
  it("names a doc after its file, and a README after its folder", () => {
    expect(projectDocTitle("docs/argus/T3-CONNECT.md")).toBe("T3 CONNECT");
    expect(projectDocTitle("docs/user_guide.md")).toBe("user guide");
    expect(projectDocTitle("docs/argus/README.md")).toBe("argus");
    expect(projectDocTitle("README.md")).toBe("README");
  });
});

describe("filterProjectDocs", () => {
  const docs = selectProjectDocs([
    file("docs/argus/ARCHITECTURE.md", 3),
    file("docs/argus/README.md", 2),
    file("docs/user/remote.md", 1),
  ]);

  it("matches every word against the path or the title", () => {
    expect(filterProjectDocs(docs, "argus arch").map((doc) => doc.path)).toEqual([
      "docs/argus/ARCHITECTURE.md",
    ]);
    expect(filterProjectDocs(docs, "REMOTE").map((doc) => doc.path)).toEqual([
      "docs/user/remote.md",
    ]);
    expect(filterProjectDocs(docs, "  ")).toBe(docs);
    expect(filterProjectDocs(docs, "missing")).toEqual([]);
  });
});
