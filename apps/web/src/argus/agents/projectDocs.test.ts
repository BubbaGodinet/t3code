import type { ProjectEntry } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  filterProjectDocs,
  projectDocFocusPath,
  projectDocTitle,
  selectProjectDocs,
} from "./projectDocs";

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

  it("keeps note folders, including gitignored ones, and skips dependency and build trees", () => {
    const docs = selectProjectDocs([
      file(".notes/foo.md", 400),
      file(".notes/nested/bar.md", 300),
      file(".github/pull_request_template.md", 200),
      file(".repos/effect/README.md", 500),
      file("node_modules/pkg/README.md", 500),
      file("packages/ui/node_modules/left-pad/README.md", 500),
      file("dist/README.md", 500),
      file("build/README.md", 500),
      file("apps/web/dist/CHANGELOG.md", 500),
      file(".git/COMMIT_EDITMSG.md", 500),
      file("notes/scratch.md", 100, true),
      file("CONTRIBUTING.md", 1),
    ]);
    expect(docs.map((doc) => doc.path)).toEqual([
      ".notes/foo.md",
      ".notes/nested/bar.md",
      ".github/pull_request_template.md",
      "notes/scratch.md",
      "CONTRIBUTING.md",
    ]);
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

describe("projectDocFocusPath", () => {
  it("routes project markdown, including note folders, to the docs modal", () => {
    expect(projectDocFocusPath("OPEN-QUESTIONS.md")).toBe("OPEN-QUESTIONS.md");
    expect(projectDocFocusPath("docs/OPEN-QUESTIONS.md")).toBe("docs/OPEN-QUESTIONS.md");
    expect(projectDocFocusPath(".notes/foo.md")).toBe(".notes/foo.md");
    expect(projectDocFocusPath(".notes/nested/bar.md")).toBe(".notes/nested/bar.md");
    expect(projectDocFocusPath("docs/guide.markdown")).toBe("docs/guide.markdown");
    expect(projectDocFocusPath("./docs/a.md")).toBe("docs/a.md");
    expect(projectDocFocusPath("notes\\scratch.md")).toBe("notes/scratch.md");
    expect(projectDocFocusPath("README.MD")).toBe("README.MD");
  });

  it("leaves other chips on their usual open", () => {
    expect(projectDocFocusPath(null)).toBeNull();
    expect(projectDocFocusPath(undefined)).toBeNull();
    expect(projectDocFocusPath("")).toBeNull();
    expect(projectDocFocusPath("src/index.ts")).toBeNull();
    expect(projectDocFocusPath("node_modules/pkg/README.md")).toBeNull();
    expect(projectDocFocusPath("packages/ui/node_modules/left-pad/README.md")).toBeNull();
    expect(projectDocFocusPath("dist/README.md")).toBeNull();
    expect(projectDocFocusPath(".git/COMMIT_EDITMSG.md")).toBeNull();
    expect(projectDocFocusPath(".repos/effect/README.md")).toBeNull();
    expect(projectDocFocusPath("/tmp/OPEN-QUESTIONS.md")).toBeNull();
    expect(projectDocFocusPath("C:/docs/a.md")).toBeNull();
    expect(projectDocFocusPath("../outside.md")).toBeNull();
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
