import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { ModelSelection, ScopedProjectRef, ScopedThreadRef } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { clampFloatRect, type MosaicFloatRect } from "./mosaicFloat";
import type { MosaicCompany, MosaicPane } from "./mosaicStore";
import { detachedFloatingPaneIds } from "./mosaicSurfaces";
import { collectPaneIds, type MosaicNode } from "./mosaicTree";

/**
 * The part of the mosaic that follows the user between clients. It is saved as
 * one JSON string in the primary server's settings (`argusMosaicLayout`), so a
 * reload, another browser, or the desktop app see the same grid. Which pane has
 * focus and whether the grid is open stay per client.
 */
export interface MosaicLayoutDocument {
  readonly companies: ReadonlyArray<MosaicCompany>;
  readonly panes: Readonly<Record<string, MosaicPane>>;
  readonly root: MosaicNode | null;
  /**
   * Floating windows by pane id. A pane popped out of the grid still holds its
   * slot in `root`; a browser or device opened to float holds none.
   */
  readonly floating: Readonly<Record<string, MosaicFloatRect>>;
  /** The model each shown thread was on at the last explicit save, by scoped thread key. */
  readonly agents: Readonly<Record<string, ModelSelection>>;
  /** When the user last pressed Save configuration (ISO time). */
  readonly savedAt: string | null;
}

const MOSAIC_LAYOUT_VERSION = 1;

const MosaicNodeRef = Schema.suspend((): Schema.Codec<MosaicNode> => MosaicNodeSchema);
const MosaicNodeSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("pane"), paneId: Schema.String }),
  Schema.Struct({
    kind: Schema.Literal("split"),
    id: Schema.String,
    direction: Schema.Literals(["row", "column"]),
    children: Schema.Array(MosaicNodeRef),
    sizes: Schema.Array(Schema.Finite),
  }),
]);

const PaneTarget = Schema.NullOr(
  Schema.Union([
    Schema.Struct({ kind: Schema.Literal("server"), threadRef: ScopedThreadRef }),
    Schema.Struct({
      kind: Schema.Literal("draft"),
      draftId: Schema.String.pipe(Schema.brand("DraftId")),
    }),
  ]),
);

const SurfaceSource = Schema.NullOr(
  Schema.Union([
    Schema.Struct({ kind: Schema.Literal("thread"), threadRef: ScopedThreadRef }),
    Schema.Struct({ kind: Schema.Literal("terminal"), threadRef: ScopedThreadRef }),
  ]),
);

const MosaicPaneSchema = Schema.Union([
  Schema.Struct({
    id: Schema.String,
    kind: Schema.Literal("chat"),
    companyId: Schema.NullOr(Schema.String),
    target: PaneTarget,
  }),
  Schema.Struct({
    id: Schema.String,
    kind: Schema.Literal("terminal"),
    companyId: Schema.NullOr(Schema.String),
    sessionThreadId: Schema.String,
    terminalId: Schema.String,
  }),
  Schema.Struct({
    id: Schema.String,
    kind: Schema.Literal("browser"),
    companyId: Schema.NullOr(Schema.String),
    source: SurfaceSource,
    url: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({
    id: Schema.String,
    kind: Schema.Literal("device"),
    companyId: Schema.NullOr(Schema.String),
    source: SurfaceSource,
    device: Schema.NullOr(
      Schema.Struct({
        hostId: Schema.String,
        deviceId: Schema.String,
        platform: Schema.Literals(["ios", "android"]),
        name: Schema.String,
      }),
    ),
  }),
]);

const FloatRectSchema = Schema.Struct({
  x: Schema.Finite,
  y: Schema.Finite,
  width: Schema.Finite,
  height: Schema.Finite,
});

// Fields after `root` were added within version 1, so documents without them still load.
const MosaicLayoutDocumentSchema = Schema.Struct({
  version: Schema.Literal(MOSAIC_LAYOUT_VERSION),
  companies: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      color: Schema.String,
      projectRef: Schema.NullOr(ScopedProjectRef),
      modelSelection: Schema.NullOr(ModelSelection),
    }),
  ),
  panes: Schema.Record(Schema.String, MosaicPaneSchema),
  root: Schema.NullOr(MosaicNodeSchema),
  floating: Schema.optionalKey(Schema.Record(Schema.String, FloatRectSchema)),
  agents: Schema.optionalKey(Schema.Record(Schema.String, ModelSelection)),
  savedAt: Schema.optionalKey(Schema.NullOr(Schema.String)),
});

const decodeLayoutDocument = Schema.decodeUnknownOption(
  Schema.fromJsonString(MosaicLayoutDocumentSchema),
);

function sortedEntries<T>(
  record: Readonly<Record<string, T>>,
  keep: (key: string) => boolean,
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(record)
      .filter(([key]) => keep(key))
      .toSorted(([left], [right]) => left.localeCompare(right)),
  );
}

/** Scoped keys of the server threads the grid shows. */
function shownThreadKeys(layout: Pick<MosaicLayoutDocument, "panes" | "root">): Set<string> {
  const keys = new Set<string>();
  for (const paneId of collectPaneIds(layout.root)) {
    const pane = layout.panes[paneId];
    if (pane?.kind === "chat" && pane.target?.kind === "server") {
      keys.add(scopedThreadKey(pane.target.threadRef));
    }
  }
  return keys;
}

/**
 * Stable JSON for a layout; equal layouts serialize to equal strings. Composer
 * drafts live in one client's storage, so a pane holding a draft is saved empty
 * and no draft text ever reaches the document.
 */
export function serializeMosaicLayout(layout: MosaicLayoutDocument): string {
  const paneIds = new Set([...collectPaneIds(layout.root), ...detachedFloatingPaneIds(layout)]);
  const threadKeys = shownThreadKeys(layout);
  return JSON.stringify({
    version: MOSAIC_LAYOUT_VERSION,
    companies: layout.companies,
    panes: Object.fromEntries(
      Object.entries(layout.panes)
        .toSorted(([left], [right]) => left.localeCompare(right))
        .map(([id, pane]) => [
          id,
          pane.kind === "chat" && pane.target?.kind === "draft" ? { ...pane, target: null } : pane,
        ]),
    ),
    root: layout.root,
    floating: sortedEntries(layout.floating, (paneId) => paneIds.has(paneId)),
    agents: sortedEntries(layout.agents, (threadKey) => threadKeys.has(threadKey)),
    savedAt: layout.savedAt,
  });
}

/**
 * The model on every server thread the grid shows, for Save configuration.
 * A thread this client has not loaded keeps the model recorded at the last save.
 */
export function captureThreadAgents(
  layout: Pick<MosaicLayoutDocument, "panes" | "root" | "agents">,
  readThreadModel: (threadRef: ScopedThreadRef) => ModelSelection | null,
): Record<string, ModelSelection> {
  const agents: Record<string, ModelSelection> = {};
  for (const paneId of collectPaneIds(layout.root)) {
    const pane = layout.panes[paneId];
    if (pane?.kind !== "chat" || pane.target?.kind !== "server") continue;
    const key = scopedThreadKey(pane.target.threadRef);
    const model = readThreadModel(pane.target.threadRef) ?? layout.agents[key] ?? null;
    if (model) agents[key] = model;
  }
  return agents;
}

/** A saved layout, keeping this client's own drafts in panes the saved copy shows empty. */
export function withLocalDrafts(
  layout: MosaicLayoutDocument,
  localPanes: Readonly<Record<string, MosaicPane>>,
): MosaicLayoutDocument {
  let panes: Record<string, MosaicPane> | null = null;
  for (const [id, pane] of Object.entries(layout.panes)) {
    const local = localPanes[id];
    if (pane.kind !== "chat" || pane.target !== null) continue;
    if (local?.kind !== "chat" || local.target?.kind !== "draft") continue;
    panes ??= { ...layout.panes };
    panes[id] = { ...pane, target: local.target };
  }
  return panes ? { ...layout, panes } : layout;
}

/** Reads a saved layout, or `null` when it is missing, from a newer build, or inconsistent. */
export function parseMosaicLayout(raw: string | null | undefined): MosaicLayoutDocument | null {
  if (!raw) return null;
  const decoded = decodeLayoutDocument(raw);
  if (decoded._tag === "None") return null;
  const { companies, panes, root } = decoded.value;
  const paneIds = collectPaneIds(root);
  if (new Set(paneIds).size !== paneIds.length || paneIds.some((id) => panes[id]?.id !== id)) {
    return null;
  }
  const floatingOnly = Object.keys(decoded.value.floating ?? {}).filter(
    (id) => !paneIds.includes(id) && panes[id]?.id === id,
  );
  const reachable = new Set([...paneIds, ...floatingOnly]);
  // Panes neither in the tree nor floating are unreachable; drop them rather than carry them forever.
  return {
    companies,
    panes: Object.fromEntries([...reachable].map((id) => [id, panes[id]!])),
    root,
    floating: Object.fromEntries(
      Object.entries(decoded.value.floating ?? {})
        .filter(([paneId]) => reachable.has(paneId))
        .map(([paneId, rect]) => [paneId, clampFloatRect(rect)]),
    ),
    agents: decoded.value.agents ?? {},
    savedAt: decoded.value.savedAt ?? null,
  };
}
