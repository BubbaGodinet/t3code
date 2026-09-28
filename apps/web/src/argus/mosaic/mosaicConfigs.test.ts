import {
  scopedProjectKey,
  scopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { DraftId } from "../../composerDraftStore";
import {
  buildMosaicPreview,
  parseMosaicConfigs,
  serializeMosaicConfigs,
  upsertMosaicConfig,
  type MosaicPreviewLookups,
} from "./mosaicConfigs";
import {
  parseMosaicLayout,
  serializeMosaicLayout,
  type MosaicLayoutDocument,
} from "./mosaicLayout";
import type { MosaicPane } from "./mosaicStore";
import { buildPresetTree } from "./mosaicTree";

const environmentId = EnvironmentId.make("env");
const acmeProject = scopeProjectRef(environmentId, ProjectId.make("acme-repo"));
const globexProject = scopeProjectRef(environmentId, ProjectId.make("globex-repo"));
const liveThread = scopeThreadRef(environmentId, ThreadId.make("live"));
const unloadedThread = scopeThreadRef(environmentId, ThreadId.make("unloaded"));
const codex = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" };
const claude = { instanceId: ProviderInstanceId.make("claude"), model: "claude-opus-4-8" };
const cursor = { instanceId: ProviderInstanceId.make("cursor"), model: "composer-2" };

function layout(): MosaicLayoutDocument {
  let splits = 0;
  const panes: MosaicPane[] = [
    {
      id: "live",
      kind: "chat",
      companyId: null,
      target: { kind: "server", threadRef: liveThread },
    },
    {
      id: "unloaded",
      kind: "chat",
      companyId: "globex",
      target: { kind: "server", threadRef: unloadedThread },
    },
    {
      id: "draft",
      kind: "chat",
      companyId: "globex",
      target: { kind: "draft", draftId: "draft-1" as DraftId },
    },
    {
      id: "term",
      kind: "terminal",
      companyId: "acme",
      sessionThreadId: "argus-terminal-term",
      terminalId: "default",
    },
  ];
  return {
    companies: [
      {
        id: "acme",
        name: "Acme",
        color: "#22c55e",
        projectRef: acmeProject,
        modelSelection: codex,
      },
      {
        id: "globex",
        name: "Globex",
        color: "#3b82f6",
        projectRef: globexProject,
        modelSelection: cursor,
      },
    ],
    panes: Object.fromEntries(panes.map((pane) => [pane.id, pane])),
    root: buildPresetTree(
      "grid-2x2",
      panes.map((pane) => pane.id),
      () => `split-${splits++}`,
    ),
    floating: { term: { x: 50, y: 50, width: 30, height: 30 } },
    agents: { [scopedThreadKey(unloadedThread)]: claude },
    savedAt: null,
    editedAt: null,
  };
}

const lookups: MosaicPreviewLookups = {
  thread: (threadRef) =>
    threadRef.threadId === liveThread.threadId
      ? { title: "Fix checkout", projectRef: acmeProject, modelSelection: claude }
      : null,
  projectTitle: (projectRef) =>
    ({ [scopedProjectKey(acmeProject)]: "acme-web", [scopedProjectKey(globexProject)]: "globex" })[
      scopedProjectKey(projectRef)
    ] ?? null,
  describeAgent: (selection) => `${selection.instanceId} · ${selection.model}`,
};

describe("configuration preview", () => {
  it("labels each pane with its company color, company, repository, and model", () => {
    const boxes = buildMosaicPreview(layout(), lookups);
    const byId = Object.fromEntries(boxes.map((box) => [box.paneId, box]));
    // The thread's project decides the company, over the pane's own pick.
    expect(byId.live).toMatchObject({
      kind: "chat",
      color: "#22c55e",
      companyName: "Acme",
      repo: "acme-web",
      agent: "claude · claude-opus-4-8",
      title: "Fix checkout",
    });
    // A thread this client has not loaded shows the model recorded at the last save.
    expect(byId.unloaded).toMatchObject({
      companyName: "Globex",
      agent: "claude · claude-opus-4-8",
    });
    expect(byId.draft).toMatchObject({ agent: "cursor · composer-2", title: "New chat" });
  });

  it("marks terminals as terminals without a model", () => {
    const term = buildMosaicPreview(layout(), lookups).find((box) => box.paneId === "term");
    expect(term).toMatchObject({
      kind: "terminal",
      title: "Terminal",
      agent: null,
      companyName: "Acme",
      color: "#22c55e",
    });
  });

  it("draws floating panes at their window, over the grid, keeping their slot", () => {
    const boxes = buildMosaicPreview(layout(), lookups);
    expect(boxes.at(-1)).toMatchObject({
      paneId: "term",
      floating: true,
      rect: { x: 50, y: 50, width: 30, height: 30 },
      slot: { x: 50, y: 50, width: 50, height: 50 },
    });
    expect(boxes.filter((box) => box.floating)).toHaveLength(1);
  });

  it("shows panes without a company uncolored", () => {
    const bare = { ...layout(), companies: [] };
    const box = buildMosaicPreview(bare, { ...lookups, thread: () => null })[0]!;
    expect(box).toMatchObject({ color: null, companyName: null, repo: null, agent: null });
  });
});

describe("named configurations", () => {
  const saved = serializeMosaicLayout(layout());
  let ids = 0;
  const newId = () => `config-${ids++}`;

  it("adds a new name beside the saved ones and replaces a repeated name in place", () => {
    const first = upsertMosaicConfig(
      [],
      { name: " Launch week ", layout: saved, savedAt: "t1" },
      newId,
    );
    const second = upsertMosaicConfig(
      first.configs,
      { name: "Quiet day", layout: saved, savedAt: "t2" },
      newId,
    );
    expect(second.configs.map((config) => config.name)).toEqual(["Launch week", "Quiet day"]);
    const replaced = upsertMosaicConfig(
      second.configs,
      { name: "launch WEEK", layout: "{}", savedAt: "t3" },
      newId,
    );
    expect(replaced.configs).toHaveLength(2);
    expect(replaced.config.id).toBe(first.config.id);
    expect(replaced.configs[0]).toMatchObject({ savedAt: "t3", layout: "{}" });
    expect(replaced.configs[1]).toBe(second.configs[1]);
  });

  it("round-trips the list, and each snapshot loads back as a layout", () => {
    const { configs } = upsertMosaicConfig(
      [],
      { name: "Launch", layout: saved, savedAt: "t" },
      newId,
    );
    const restored = parseMosaicConfigs(serializeMosaicConfigs(configs));
    expect(restored).toEqual(configs);
    const snapshot = parseMosaicLayout(restored[0]!.layout)!;
    expect(snapshot.root).toEqual(layout().root);
    expect(snapshot.floating).toEqual(layout().floating);
    expect(snapshot.companies.map((company) => company.color)).toEqual(["#22c55e", "#3b82f6"]);
    expect(restored[0]!.layout).not.toContain("draft-1");
  });

  it("reads missing or unreadable lists as empty", () => {
    expect(parseMosaicConfigs(null)).toEqual([]);
    expect(parseMosaicConfigs("{nope")).toEqual([]);
    expect(parseMosaicConfigs(JSON.stringify({ version: 2, configs: [] }))).toEqual([]);
  });
});
