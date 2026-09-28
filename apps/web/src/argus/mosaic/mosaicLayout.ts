import { ModelSelection, ScopedProjectRef, ScopedThreadRef } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import type { MosaicCompany, MosaicPane } from "./mosaicStore";
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
]);

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
});

const decodeLayoutDocument = Schema.decodeUnknownOption(
  Schema.fromJsonString(MosaicLayoutDocumentSchema),
);

/**
 * Stable JSON for a layout; equal layouts serialize to equal strings. Composer
 * drafts live in one client's storage, so a pane holding a draft is saved empty.
 */
export function serializeMosaicLayout(layout: MosaicLayoutDocument): string {
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
  });
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
  // Panes outside the tree are unreachable; drop them rather than carry them forever.
  return {
    companies,
    panes: Object.fromEntries(paneIds.map((id) => [id, panes[id]!])),
    root,
  };
}
