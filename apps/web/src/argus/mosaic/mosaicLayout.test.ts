import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { DraftId } from "../../composerDraftStore";
import {
  parseMosaicLayout,
  serializeMosaicLayout,
  withLocalDrafts,
  type MosaicLayoutDocument,
} from "./mosaicLayout";
import type { MosaicPane } from "./mosaicStore";
import { buildPresetTree, resizeSplit, swapPanes } from "./mosaicTree";

const environmentId = EnvironmentId.make("env");
const draftId = "draft-1" as DraftId;

function layout(): MosaicLayoutDocument {
  let splits = 0;
  const panes: MosaicPane[] = [
    {
      id: "chat",
      kind: "chat",
      companyId: "acme",
      target: { kind: "server", threadRef: scopeThreadRef(environmentId, ThreadId.make("t1")) },
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
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
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

  it("rejects missing, malformed, future, and inconsistent documents", () => {
    expect(parseMosaicLayout(null)).toBeNull();
    expect(parseMosaicLayout("{not json")).toBeNull();
    const saved = JSON.parse(serializeMosaicLayout(layout()));
    expect(parseMosaicLayout(JSON.stringify({ ...saved, version: 2 }))).toBeNull();
    const { term: _term, ...withoutTerminal } = saved.panes;
    expect(parseMosaicLayout(JSON.stringify({ ...saved, panes: withoutTerminal }))).toBeNull();
  });

  it("drops panes the tree no longer reaches", () => {
    const saved = JSON.parse(serializeMosaicLayout(layout()));
    saved.panes.orphan = { id: "orphan", kind: "chat", companyId: null, target: null };
    expect(parseMosaicLayout(JSON.stringify(saved))?.panes).not.toHaveProperty("orphan");
  });
});
