import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ModelSelection, ScopedProjectRef, ScopedThreadRef } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import type { MosaicLayoutDocument } from "./mosaicLayout";
import { resolvePaneCompany, type MosaicPane } from "./mosaicStore";
import { detachedFloatingPaneIds } from "./mosaicSurfaces";
import { layoutMosaic, type MosaicRect } from "./mosaicTree";

/**
 * A layout the user saved under a name so they can switch back to it. The list
 * lives in the primary server's settings (`argusMosaicConfigs`), separate from
 * the live layout that saves itself as the user works.
 */
export interface MosaicNamedConfig {
  readonly id: string;
  readonly name: string;
  readonly savedAt: string;
  /** `serializeMosaicLayout` output, so drafts are already stripped. */
  readonly layout: string;
}

const MOSAIC_CONFIGS_VERSION = 1;

const MosaicConfigsDocument = Schema.Struct({
  version: Schema.Literal(MOSAIC_CONFIGS_VERSION),
  configs: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      savedAt: Schema.String,
      layout: Schema.String,
    }),
  ),
});

const decodeConfigsDocument = Schema.decodeUnknownOption(
  Schema.fromJsonString(MosaicConfigsDocument),
);

/** The saved configurations, or none when missing, from a newer build, or unreadable. */
export function parseMosaicConfigs(
  raw: string | null | undefined,
): ReadonlyArray<MosaicNamedConfig> {
  if (!raw) return [];
  const decoded = decodeConfigsDocument(raw);
  return decoded._tag === "Some" ? decoded.value.configs : [];
}

export function serializeMosaicConfigs(configs: ReadonlyArray<MosaicNamedConfig>): string {
  return JSON.stringify({ version: MOSAIC_CONFIGS_VERSION, configs });
}

function sameName(left: string, right: string): boolean {
  return left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase();
}

export function findConfigByName(
  configs: ReadonlyArray<MosaicNamedConfig>,
  name: string,
): MosaicNamedConfig | null {
  return configs.find((config) => sameName(config.name, name)) ?? null;
}

/**
 * Adds a configuration, or replaces the one already saved under that name
 * (ignoring case) in place. Every other configuration is kept as it was.
 */
export function upsertMosaicConfig(
  configs: ReadonlyArray<MosaicNamedConfig>,
  input: { readonly name: string; readonly layout: string; readonly savedAt: string },
  newId: () => string,
): { readonly configs: ReadonlyArray<MosaicNamedConfig>; readonly config: MosaicNamedConfig } {
  const name = input.name.trim();
  const existing = findConfigByName(configs, name);
  const config: MosaicNamedConfig = {
    id: existing?.id ?? newId(),
    name,
    savedAt: input.savedAt,
    layout: input.layout,
  };
  return {
    config,
    configs: existing
      ? configs.map((entry) => (entry.id === existing.id ? config : entry))
      : [...configs, config],
  };
}

export interface MosaicPreviewBox {
  readonly paneId: string;
  readonly kind: MosaicPane["kind"];
  /** Where the pane shows, in grid percent: its floating window, or its slot. */
  readonly rect: MosaicRect;
  /** Its slot in the split tree, which a floating pane keeps. */
  readonly slot: MosaicRect;
  readonly floating: boolean;
  readonly color: string | null;
  readonly companyName: string | null;
  readonly repo: string | null;
  /** The model the chat runs on; terminals have none. */
  readonly agent: string | null;
  readonly title: string | null;
}

export interface MosaicPreviewLookups {
  readonly thread: (threadRef: ScopedThreadRef) => {
    readonly title: string;
    readonly projectRef: ScopedProjectRef;
    readonly modelSelection: ModelSelection;
  } | null;
  readonly projectTitle: (projectRef: ScopedProjectRef) => string | null;
  readonly describeAgent: (selection: ModelSelection) => string;
}

/**
 * What Save configuration shows for a layout: one box per pane with its
 * company's color, the company, repository, and model, floating panes over
 * the grid after the docked ones.
 */
export function buildMosaicPreview(
  layout: Pick<MosaicLayoutDocument, "companies" | "panes" | "root" | "floating" | "agents">,
  lookups: MosaicPreviewLookups,
): ReadonlyArray<MosaicPreviewBox> {
  const slots = [
    ...layoutMosaic(layout.root).panes,
    ...detachedFloatingPaneIds(layout).map((paneId) => ({
      paneId,
      rect: layout.floating[paneId]!,
    })),
  ];
  const boxes = slots.flatMap(({ paneId, rect: slot }) => {
    const pane = layout.panes[paneId];
    if (!pane) return [];
    const threadRef =
      pane.kind === "chat"
        ? pane.target?.kind === "server"
          ? pane.target.threadRef
          : null
        : (pane.kind === "browser" || pane.kind === "device") && pane.source?.kind === "thread"
          ? pane.source.threadRef
          : null;
    const thread = threadRef ? lookups.thread(threadRef) : null;
    const company = resolvePaneCompany(layout.companies, pane, thread?.projectRef ?? null);
    const projectRef = thread?.projectRef ?? company?.projectRef ?? null;
    let agent: ModelSelection | null = null;
    if (pane.kind === "chat") {
      const saved =
        pane.target?.kind === "server"
          ? layout.agents[scopedThreadKey(pane.target.threadRef)]
          : undefined;
      agent = thread?.modelSelection ?? saved ?? company?.modelSelection ?? null;
    }
    const float = layout.floating[paneId];
    const box: MosaicPreviewBox = {
      paneId,
      kind: pane.kind,
      rect: float ?? slot,
      slot,
      floating: float !== undefined,
      color: company?.color ?? null,
      companyName: company?.name ?? null,
      repo: projectRef ? lookups.projectTitle(projectRef) : null,
      agent: agent ? lookups.describeAgent(agent) : null,
      title:
        pane.kind === "terminal"
          ? "Terminal"
          : pane.kind === "browser"
            ? "Browser"
            : pane.kind === "device"
              ? (pane.device?.name ?? "Emulator")
              : (thread?.title ?? (pane.target ? "New chat" : "Empty pane")),
    };
    return [box];
  });
  return [...boxes.filter((box) => !box.floating), ...boxes.filter((box) => box.floating)];
}
