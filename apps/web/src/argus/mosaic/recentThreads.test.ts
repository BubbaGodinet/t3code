import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { DraftId } from "../../composerDraftStore";
import type { MosaicCompany, MosaicPane } from "./mosaicStore";
import { companyForThread, groupRecentThreads, type RecentThreadRef } from "./recentThreads";

const environmentId = EnvironmentId.make("env");
const otherEnvironmentId = EnvironmentId.make("other-env");

function company(
  id: string,
  name: string,
  projectId: string | null,
  color = "#22c55e",
): MosaicCompany {
  return {
    id,
    name,
    color,
    projectRef: projectId ? scopeProjectRef(environmentId, ProjectId.make(projectId)) : null,
    modelSelection: null,
  };
}

function thread(
  id: string,
  projectId: string,
  updatedAt: string,
  archivedAt: string | null = null,
  env: EnvironmentId = environmentId,
): RecentThreadRef {
  return {
    environmentId: env,
    id: ThreadId.make(id),
    projectId: ProjectId.make(projectId),
    updatedAt,
    archivedAt,
  };
}

function chat(id: string, companyId: string | null, threadId: string | null): MosaicPane {
  return {
    id,
    kind: "chat",
    companyId,
    target: threadId
      ? { kind: "server", threadRef: scopeThreadRef(environmentId, ThreadId.make(threadId)) }
      : null,
  };
}

const studio = company("studio", "The Studio", "thestudio", "#6146c3");
const argus = company("argus", "Argus", "argus", "#3b82f6");
const unbound = company("notes", "Notes", null, "");

describe("companyForThread", () => {
  it("assigns a thread to the company whose repository it is in", () => {
    expect(
      companyForThread(thread("one", "thestudio", "2026-10-01T00:00:00.000Z"), [studio, argus], []),
    ).toBe(studio);
  });

  it("does not treat the same project id on another environment as that company", () => {
    expect(
      companyForThread(
        thread("one", "thestudio", "2026-10-01T00:00:00.000Z", null, otherEnvironmentId),
        [studio],
        [],
      ),
    ).toBeNull();
  });

  it("uses the first company when two share a repository", () => {
    const alsoStudio = company("studio-copy", "Studio copy", "thestudio");
    expect(
      companyForThread(
        thread("one", "thestudio", "2026-10-01T00:00:00.000Z"),
        [studio, alsoStudio],
        [],
      ),
    ).toBe(studio);
  });

  it("uses a pane already bound to a company and showing the thread", () => {
    const orphan = thread("one", "loose", "2026-10-01T00:00:00.000Z");
    expect(companyForThread(orphan, [studio, unbound], [chat("pane", "notes", "one")])).toBe(
      unbound,
    );
  });

  it("keeps the repository company when a pane is bound to a different company", () => {
    expect(
      companyForThread(
        thread("one", "thestudio", "2026-10-01T00:00:00.000Z"),
        [studio, argus],
        [chat("pane", "argus", "one")],
      ),
    ).toBe(studio);
  });

  it("follows a browser pane that is showing the chat", () => {
    const browser: MosaicPane = {
      id: "browser",
      kind: "browser",
      companyId: "argus",
      source: { kind: "thread", threadRef: scopeThreadRef(environmentId, ThreadId.make("one")) },
      url: null,
    };
    expect(
      companyForThread(thread("one", "loose", "2026-10-01T00:00:00.000Z"), [argus], [browser]),
    ).toBe(argus);
  });

  it("ignores a terminal session and a draft pane", () => {
    const browser: MosaicPane = {
      id: "browser",
      kind: "browser",
      companyId: "argus",
      source: { kind: "terminal", threadRef: scopeThreadRef(environmentId, ThreadId.make("one")) },
      url: null,
    };
    const draft: MosaicPane = {
      id: "draft",
      kind: "chat",
      companyId: "argus",
      target: { kind: "draft", draftId: "draft-1" as DraftId },
    };
    expect(
      companyForThread(
        thread("one", "loose", "2026-10-01T00:00:00.000Z"),
        [argus],
        [browser, draft],
      ),
    ).toBeNull();
  });

  it("ignores a pane binding whose company is gone", () => {
    expect(
      companyForThread(
        thread("one", "loose", "2026-10-01T00:00:00.000Z"),
        [studio],
        [chat("pane", "missing", "one")],
      ),
    ).toBeNull();
  });

  it("uses the first pane that still names a company", () => {
    expect(
      companyForThread(
        thread("one", "loose", "2026-10-01T00:00:00.000Z"),
        [studio, argus],
        [
          chat("empty", null, "one"),
          chat("studio-pane", "studio", "one"),
          chat("argus-pane", "argus", "one"),
        ],
      ),
    ).toBe(studio);
  });
});

describe("groupRecentThreads", () => {
  it("groups threads under companies and leaves the rest in Other", () => {
    const sections = groupRecentThreads(
      [
        thread("studio-new", "thestudio", "2026-10-01T03:00:00.000Z"),
        thread("loose", "loose", "2026-10-01T02:00:00.000Z"),
        thread("argus-old", "argus", "2026-10-01T01:00:00.000Z"),
        thread("studio-old", "thestudio", "2026-09-30T01:00:00.000Z"),
        thread("archived", "thestudio", "2026-10-01T04:00:00.000Z", "2026-10-01T05:00:00.000Z"),
      ],
      [argus, studio],
      [],
    );

    expect(sections.map((section) => section.company?.name ?? "Other")).toEqual([
      "Argus",
      "The Studio",
      "Other",
    ]);
    expect(sections[0]?.threads.map((entry) => entry.id)).toEqual([ThreadId.make("argus-old")]);
    expect(sections[1]?.threads.map((entry) => entry.id)).toEqual([
      ThreadId.make("studio-new"),
      ThreadId.make("studio-old"),
    ]);
    expect(sections[2]?.threads.map((entry) => entry.id)).toEqual([ThreadId.make("loose")]);
  });

  it("omits companies that have no thread in the recent window", () => {
    const sections = groupRecentThreads(
      [thread("one", "thestudio", "2026-10-01T00:00:00.000Z")],
      [studio, argus],
      [],
    );
    expect(sections.map((section) => section.id)).toEqual(["studio"]);
  });

  it("puts a pane-bound thread under that company, not Other", () => {
    const sections = groupRecentThreads(
      [thread("one", "loose", "2026-10-01T00:00:00.000Z")],
      [unbound],
      [chat("pane", "notes", "one")],
    );
    expect(sections.map((section) => section.id)).toEqual(["notes"]);
  });

  it("keeps only the newest threads before grouping", () => {
    const sections = groupRecentThreads(
      [
        thread("new", "thestudio", "2026-10-01T02:00:00.000Z"),
        thread("mid", "argus", "2026-10-01T01:00:00.000Z"),
        thread("old", "loose", "2026-09-01T00:00:00.000Z"),
      ],
      [studio, argus],
      [],
      2,
    );
    expect(sections.map((section) => section.id)).toEqual(["studio", "argus"]);
  });
});
