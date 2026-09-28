import { scopeProjectRef, scopedProjectKey } from "@t3tools/client-runtime/environment";
import type { ModelSelection } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import {
  CheckIcon,
  ChevronDownIcon,
  LayersIcon,
  MessageSquareIcon,
  PictureInPicture2Icon,
  SaveIcon,
  SquareTerminalIcon,
} from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../../components/ui/menu";
import { stackedThreadToast, toastManager } from "../../components/ui/toast";
import { cn } from "../../lib/utils";
import { deriveProviderInstanceEntries } from "../../providerInstances";
import { readThreadShell, useProjects } from "../../state/entities";
import { environmentServerConfigsAtom } from "../../state/server";
import { buildMosaicPreview, findConfigByName, type MosaicPreviewBox } from "./mosaicConfigs";
import { useMosaicStore } from "./mosaicStore";
import type { useMosaicConfigs } from "./useMosaicConfigs";

type MosaicConfigs = ReturnType<typeof useMosaicConfigs>;

/** Opaque so floating boxes cover the boxes under them. */
function boxFill(color: string | null): string {
  return color
    ? `color-mix(in srgb, ${color} 30%, var(--background))`
    : "color-mix(in srgb, var(--muted-foreground) 14%, var(--background))";
}

function rectStyle(rect: MosaicPreviewBox["rect"]) {
  return {
    left: `${rect.x}%`,
    top: `${rect.y}%`,
    width: `${rect.width}%`,
    height: `${rect.height}%`,
  };
}

/** The live grid as preview boxes, labeled with each pane's company, repository, and model. */
function useLivePreview(open: boolean): ReadonlyArray<MosaicPreviewBox> {
  const companies = useMosaicStore((state) => state.companies);
  const panes = useMosaicStore((state) => state.panes);
  const root = useMosaicStore((state) => state.root);
  const floating = useMosaicStore((state) => state.floating);
  const agents = useMosaicStore((state) => state.agents);
  const projects = useProjects();
  const serverConfigs = useAtomValue(environmentServerConfigsAtom);

  return useMemo(() => {
    if (!open) return [];
    const projectTitles = new Map(
      projects.map((project) => [
        scopedProjectKey(scopeProjectRef(project.environmentId, project.id)),
        project.title,
      ]),
    );
    const providerNames = new Map<string, string>();
    for (const config of serverConfigs.values()) {
      for (const entry of deriveProviderInstanceEntries(config.providers)) {
        providerNames.set(entry.instanceId, entry.displayName);
      }
    }
    const describeAgent = (selection: ModelSelection) => {
      const provider = providerNames.get(selection.instanceId);
      return provider ? `${provider} · ${selection.model}` : selection.model;
    };
    return buildMosaicPreview(
      { companies, panes, root, floating, agents },
      {
        thread: (threadRef) => {
          const shell = readThreadShell(threadRef);
          return shell
            ? {
                title: shell.title,
                projectRef: scopeProjectRef(shell.environmentId, shell.projectId),
                modelSelection: shell.modelSelection,
              }
            : null;
        },
        projectTitle: (projectRef) => projectTitles.get(scopedProjectKey(projectRef)) ?? null,
        describeAgent,
      },
    );
  }, [agents, companies, floating, open, panes, projects, root, serverConfigs]);
}

function LayoutPreview({ boxes }: { boxes: ReadonlyArray<MosaicPreviewBox> }) {
  if (boxes.length === 0) {
    return (
      <div className="flex aspect-[16/9] w-full items-center justify-center rounded-lg border border-dashed text-xs text-muted-foreground">
        The grid is empty.
      </div>
    );
  }
  return (
    <div
      aria-label="Layout preview"
      className="relative aspect-[16/9] w-full overflow-hidden rounded-lg border bg-muted/30"
    >
      {boxes
        .filter((box) => box.floating)
        .map((box) => (
          <div key={`slot:${box.paneId}`} className="absolute p-0.5" style={rectStyle(box.slot)}>
            <div className="h-full rounded-md border border-dashed border-muted-foreground/40" />
          </div>
        ))}
      {boxes.map((box) => (
        <div
          key={box.paneId}
          className={cn("absolute p-0.5", box.floating && "z-10")}
          style={rectStyle(box.rect)}
        >
          <div
            className={cn(
              "flex h-full flex-col gap-0.5 overflow-hidden rounded-md border px-1.5 py-1 text-[10px] leading-tight text-foreground",
              box.floating && "shadow-lg ring-1 ring-foreground/25",
            )}
            style={{
              backgroundColor: boxFill(box.color),
              borderColor: box.color ?? undefined,
            }}
          >
            <span className="truncate font-semibold">{box.companyName ?? "No company"}</span>
            <span className="flex min-w-0 items-center gap-1 truncate text-foreground/80">
              {box.kind === "terminal" ? (
                <>
                  <SquareTerminalIcon className="size-3 shrink-0" />
                  Terminal
                </>
              ) : (
                (box.agent ?? "Default agent")
              )}
            </span>
            {box.floating ? (
              <span className="mt-auto flex items-center gap-1 text-[9px] font-medium tracking-wide text-foreground/70 uppercase">
                <PictureInPicture2Icon className="size-2.5" />
                Floating
              </span>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function PaneDetails({ boxes }: { boxes: ReadonlyArray<MosaicPreviewBox> }) {
  return (
    <ul className="flex flex-col divide-y rounded-lg border text-xs">
      {boxes.map((box) => (
        <li key={box.paneId} className="flex items-center gap-2 px-2.5 py-1.5">
          <span
            className="size-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: box.color ?? "var(--muted-foreground)" }}
          />
          {box.kind === "terminal" ? (
            <SquareTerminalIcon className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <MessageSquareIcon className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate font-medium">
              {box.companyName ?? "No company"}
              {box.repo ? <span className="text-muted-foreground"> · {box.repo}</span> : null}
            </span>
            <span className="truncate text-muted-foreground">
              {box.kind === "terminal" ? "Terminal" : `Chat · ${box.title}`}
              {box.kind === "chat" ? ` · ${box.agent ?? "Default agent"}` : ""}
            </span>
          </div>
          {box.floating ? (
            <span className="shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] text-muted-foreground">
              Floating
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** Save configuration: name the live grid and store it on the server beside the other saved ones. */
export function SaveConfigurationButton({
  configs,
  ready,
  saveConfig,
}: Pick<MosaicConfigs, "configs" | "ready" | "saveConfig">) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const boxes = useLivePreview(open);
  const replacing = name.trim() ? findConfigByName(configs, name) : null;

  const openDialog = () => {
    const { activeConfigId } = useMosaicStore.getState();
    setName(configs.find((config) => config.id === activeConfigId)?.name ?? "");
    setOpen(true);
  };

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    const result = await saveConfig(trimmed);
    setSaving(false);
    if (!result.ok) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Configuration not saved",
          description: result.message,
        }),
      );
      return;
    }
    setOpen(false);
    toastManager.add(
      stackedThreadToast({
        type: "success",
        title: `Saved "${result.config.name}"`,
        description: "Switch back to it any time from Configurations.",
      }),
    );
  };

  return (
    <>
      <Button size="xs" disabled={!ready} onClick={openDialog}>
        <SaveIcon />
        Save configuration
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogPopup className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Save configuration</DialogTitle>
            <DialogDescription>
              Saves the layout, panes, companies, colors, floating panes, and each chat's model.
              Unsent messages are not saved.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="flex max-h-[65vh] flex-col gap-3 overflow-y-auto text-sm">
            <form
              className="flex flex-col gap-1"
              onSubmit={(event) => {
                event.preventDefault();
                void save();
              }}
            >
              <Input
                aria-label="Configuration name"
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Name it, e.g. Launch week"
                disabled={saving}
              />
              {replacing ? (
                <span className="text-xs text-muted-foreground">
                  Replaces the saved configuration "{replacing.name}".
                </span>
              ) : null}
            </form>
            <LayoutPreview boxes={boxes} />
            {boxes.length > 0 ? <PaneDetails boxes={boxes} /> : null}
          </DialogPanel>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={!name.trim() || saving} onClick={() => void save()}>
              <SaveIcon />
              {saving ? "Saving…" : replacing ? "Replace" : "Save"}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
}

function formatSavedAt(savedAt: string): string {
  const date = new Date(savedAt);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
}

/** The saved configurations; picking one makes it the live grid. */
export function ConfigurationSwitcher({
  configs,
  loadConfig,
}: Pick<MosaicConfigs, "configs" | "loadConfig">) {
  const activeConfigId = useMosaicStore((state) => state.activeConfigId);
  const active = configs.find((config) => config.id === activeConfigId) ?? null;

  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            size="xs"
            variant="outline"
            aria-label="Saved configurations"
            className="max-w-56"
          />
        }
      >
        <LayersIcon />
        <span className="truncate">{active?.name ?? "Configurations"}</span>
        <ChevronDownIcon />
      </MenuTrigger>
      <MenuPopup align="end" className="min-w-56">
        {configs.length === 0 ? (
          <MenuItem disabled>No saved configurations yet</MenuItem>
        ) : (
          configs.map((config) => (
            <MenuItem key={config.id} onClick={() => loadConfig(config)}>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">{config.name}</span>
                <span className="truncate text-[11px] text-muted-foreground">
                  {formatSavedAt(config.savedAt)}
                </span>
              </div>
              {config.id === activeConfigId ? <CheckIcon className="ms-auto size-3.5" /> : null}
            </MenuItem>
          ))
        )}
      </MenuPopup>
    </Menu>
  );
}
