import {
  scopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { DraftId } from "../../composerDraftStore";
import {
  captureThreadAgents,
  parseMosaicLayout,
  reconcileMosaicLayout,
  serializeMosaicLayout,
  withLocalDrafts,
  type MosaicLayoutDocument,
} from "./mosaicLayout";
import type { MosaicPane } from "./mosaicStore";
import { buildPresetTree, resizeSplit, swapPanes } from "./mosaicTree";

const environmentId = EnvironmentId.make("env");
const draftId = "draft-1" as DraftId;
const threadRef = scopeThreadRef(environmentId, ThreadId.make("t1"));
const codex = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" };
const claude = { instanceId: ProviderInstanceId.make("claude"), model: "claude-opus-4-8" };

function layout(): MosaicLayoutDocument {
  let splits = 0;
  const panes: MosaicPane[] = [
    {
      id: "chat",
      kind: "chat",
      companyId: "acme",
      target: { kind: "server", threadRef },
    },
    { id: "draft", kind: "chat", companyId: null, target: { kind: "draft", draftId } },
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
        projectRef: scopeProjectRef(environmentId, ProjectId.make("p1")),
        modelSelection: codex,
      },
    ],
    panes: Object.fromEntries(panes.map((pane) => [pane.id, pane])),
    root: resizeSplit(
      buildPresetTree(
        "two-over-one",
        panes.map((pane) => pane.id),
        () => `split-${splits++}`,
      ),
      "split-0",
      0,
      15,
    ),
    floating: { term: { x: 10, y: 20, width: 40, height: 30 } },
    agents: { [scopedThreadKey(threadRef)]: claude },
    savedAt: "2026-09-28T22:00:00.000Z",
    editedAt: "2026-09-28T22:05:00.000Z",
  };
}

function emptyLayout(editedAt: string | null = null): MosaicLayoutDocument {
  return {
    companies: [],
    panes: {},
    root: null,
    floating: {},
    agents: {},
    savedAt: null,
    editedAt,
  };
}

describe("mosaic layout document", () => {
  it("round-trips the tree, sizes, pane contents, and company colors", () => {
    const saved = serializeMosaicLayout(layout());
    const restored = parseMosaicLayout(saved)!;
    expect(restored.root).toEqual(layout().root);
    expect(restored.companies).toEqual(layout().companies);
    expect(restored.panes.chat).toEqual(layout().panes.chat);
    expect(restored.panes.term).toEqual(layout().panes.term);
    expect(serializeMosaicLayout(restored)).toBe(saved);
  });

  it("saves floating windows, each thread's agent, and the save time", () => {
    const restored = parseMosaicLayout(serializeMosaicLayout(layout()))!;
    expect(restored.floating).toEqual(layout().floating);
    expect(restored.agents).toEqual(layout().agents);
    expect(restored.savedAt).toBe(layout().savedAt);
  });

  it("drops floating windows and agents for panes and threads no longer shown", () => {
    const original = layout();
    const saved = JSON.parse(
      serializeMosaicLayout({
        ...original,
        floating: { ...original.floating, gone: { x: 0, y: 0, width: 30, height: 30 } },
        agents: { ...original.agents, "env:elsewhere": codex },
      }),
    );
    expect(Object.keys(saved.floating)).toEqual(["term"]);
    expect(Object.keys(saved.agents)).toEqual([scopedThreadKey(threadRef)]);
  });

  it("never writes draft text or draft agents into the saved document", () => {
    const saved = serializeMosaicLayout(layout());
    expect(saved).not.toContain(draftId);
    expect(JSON.parse(saved).panes.draft.target).toBeNull();
  });

  it("captures the live model of each shown thread, keeping the last one for unloaded threads", () => {
    const live = captureThreadAgents(layout(), () => codex);
    expect(live).toEqual({ [scopedThreadKey(threadRef)]: codex });
    const unloaded = captureThreadAgents(layout(), () => null);
    expect(unloaded).toEqual({ [scopedThreadKey(threadRef)]: claude });
    expect(captureThreadAgents({ ...layout(), agents: {} }, () => null)).toEqual({});
  });

  it("loads documents saved before floating panes and agents existed", () => {
    const saved = JSON.parse(serializeMosaicLayout(layout()));
    delete saved.floating;
    delete saved.agents;
    delete saved.savedAt;
    const restored = parseMosaicLayout(JSON.stringify(saved))!;
    expect(restored).toMatchObject({ floating: {}, agents: {}, savedAt: null });
    expect(restored.root).toEqual(layout().root);
  });

  it("saves a swap as a new layout", () => {
    const original = layout();
    const swapped = { ...original, root: swapPanes(original.root, "chat", "term") };
    expect(serializeMosaicLayout(swapped)).not.toBe(serializeMosaicLayout(original));
    expect(parseMosaicLayout(serializeMosaicLayout(swapped))?.root).toEqual(swapped.root);
  });

  it("saves a client's draft pane as empty and keeps the draft only on that client", () => {
    const restored = parseMosaicLayout(serializeMosaicLayout(layout()))!;
    expect(restored.panes.draft).toMatchObject({ kind: "chat", target: null });
    expect(withLocalDrafts(restored, layout().panes).panes.draft).toMatchObject({
      target: { kind: "draft", draftId },
    });
    expect(withLocalDrafts(restored, {})).toBe(restored);
  });

  it("rejects missing, malformed, and future documents", () => {
    expect(parseMosaicLayout(null)).toBeNull();
    expect(parseMosaicLayout("{not json")).toBeNull();
    const saved = JSON.parse(serializeMosaicLayout(layout()));
    expect(parseMosaicLayout(JSON.stringify({ ...saved, version: 2 }))).toBeNull();
  });

  it("keeps the companies when the grid is inconsistent or one company is unreadable", () => {
    const saved = JSON.parse(serializeMosaicLayout(layout()));
    const { term: _term, ...withoutTerminal } = saved.panes;
    const inconsistent = parseMosaicLayout(JSON.stringify({ ...saved, panes: withoutTerminal }))!;
    expect(inconsistent).toMatchObject({ root: null, panes: {}, floating: {} });
    expect(inconsistent.companies).toEqual(layout().companies);

    const withBadCompany = { ...saved, companies: [...saved.companies, { id: 7 }] };
    expect(parseMosaicLayout(JSON.stringify(withBadCompany))?.companies).toEqual(
      layout().companies,
    );
  });

  it("round-trips companies, their agent and repo, and the edit time through the save payload", () => {
    const payload = JSON.parse(serializeMosaicLayout(layout()));
    expect(payload.companies).toEqual([
      {
        id: "acme",
        name: "Acme",
        color: "#22c55e",
        projectRef: { environmentId: "env", projectId: "p1" },
        modelSelection: codex,
      },
    ]);
    const restored = parseMosaicLayout(JSON.stringify(payload))!;
    expect(restored.companies).toEqual(layout().companies);
    expect(restored.editedAt).toBe(layout().editedAt);
  });

  describe("reconciling with the server on startup", () => {
    it("loads the saved companies instead of saving an empty startup over them", () => {
      const saved = serializeMosaicLayout(layout());
      const step = reconcileMosaicLayout(saved, emptyLayout());
      expect(step.kind).toBe("apply");
      expect(step.kind === "apply" && step.layout.companies).toEqual(layout().companies);
    });

    it("loads the server copy over an older cached copy that lost its companies", () => {
      const stale = { ...layout(), companies: [], editedAt: "2026-09-28T21:00:00.000Z" };
      const step = reconcileMosaicLayout(serializeMosaicLayout(layout()), stale);
      expect(step.kind === "apply" && step.layout.companies).toEqual(layout().companies);
    });

    it("pushes a cached edit the server never received", () => {
      const later = { ...layout(), editedAt: "2026-09-28T23:00:00.000Z" };
      expect(reconcileMosaicLayout(serializeMosaicLayout(layout()), later)).toEqual({
        kind: "push",
      });
    });

    it("never saves over a document it cannot read, or an empty grid over nothing", () => {
      const future = JSON.stringify({ ...JSON.parse(serializeMosaicLayout(layout())), version: 2 });
      expect(reconcileMosaicLayout(future, layout())).toEqual({ kind: "blocked" });
      expect(reconcileMosaicLayout(null, emptyLayout())).toEqual({ kind: "idle" });
      expect(reconcileMosaicLayout(null, layout())).toEqual({ kind: "push" });
    });
  });

  it("keeps a browser floating over the grid and a device pane in the grid", () => {
    const original = layout();
    const withSurfaces: MosaicLayoutDocument = {
      ...original,
      panes: {
        ...original.panes,
        browser: {
          id: "browser",
          kind: "browser",
          companyId: "acme",
          source: { kind: "thread", threadRef },
          url: "http://localhost:5173/",
        },
        phone: {
          id: "phone",
          kind: "device",
          companyId: "acme",
          source: { kind: "thread", threadRef },
          device: { hostId: "local", deviceId: "UDID-1", platform: "ios", name: "iPhone 18 Pro" },
        },
      },
      root: buildPresetTree("row", ["chat", "draft", "term", "phone"], () => "split"),
      floating: { browser: { x: 30, y: 20, width: 40, height: 50 } },
    };
    const restored = parseMosaicLayout(serializeMosaicLayout(withSurfaces))!;
    expect(restored.panes.browser).toEqual(withSurfaces.panes.browser);
    expect(restored.panes.phone).toEqual(withSurfaces.panes.phone);
    expect(restored.floating).toEqual(withSurfaces.floating);
  });

  it("drops panes the tree no longer reaches", () => {
    const saved = JSON.parse(serializeMosaicLayout(layout()));
    saved.panes.orphan = { id: "orphan", kind: "chat", companyId: null, target: null };
    expect(parseMosaicLayout(JSON.stringify(saved))?.panes).not.toHaveProperty("orphan");
  });
});
