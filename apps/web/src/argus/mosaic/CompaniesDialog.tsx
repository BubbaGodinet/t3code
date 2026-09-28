import { scopedProjectKey, scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { ModelSelection, ProviderInstanceId } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { create } from "zustand";

import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { randomUUID } from "../../lib/utils";
import {
  deriveProviderInstanceEntries,
  getDefaultProviderInstanceModel,
} from "../../providerInstances";
import { useProjects } from "../../state/entities";
import { environmentServerConfigsAtom } from "../../state/server";
import { COMPANY_COLOR_PALETTE, useMosaicStore, type MosaicCompany } from "./mosaicStore";

export const useCompaniesDialog = create<{ open: boolean; setOpen: (open: boolean) => void }>()(
  (set) => ({ open: false, setOpen: (open) => set({ open }) }),
);

const SELECT_CLASS =
  "h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm text-foreground";

function CompanyRow({ company }: { company: MosaicCompany }) {
  const upsertCompany = useMosaicStore((state) => state.upsertCompany);
  const removeCompany = useMosaicStore((state) => state.removeCompany);
  const projects = useProjects();
  const serverConfigs = useAtomValue(environmentServerConfigsAtom);
  const providers = company.projectRef
    ? (serverConfigs.get(company.projectRef.environmentId)?.providers ?? [])
    : [];
  const providerEntries = deriveProviderInstanceEntries(providers).filter(
    (entry) => entry.enabled && entry.installed,
  );
  const update = (patch: Partial<MosaicCompany>) => upsertCompany({ ...company, ...patch });

  return (
    <div
      className="flex flex-col gap-2 rounded-lg border p-3"
      style={{ borderColor: company.color }}
    >
      <div className="flex items-center gap-2">
        <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: company.color }} />
        <Input
          aria-label="Company name"
          value={company.name}
          onChange={(event) => update({ name: event.target.value })}
          placeholder="Company name"
        />
        <Button
          aria-label={`Remove ${company.name}`}
          size="icon-xs"
          variant="ghost"
          onClick={() => removeCompany(company.id)}
        >
          <Trash2Icon />
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {COMPANY_COLOR_PALETTE.map((color) => (
          <button
            key={color}
            type="button"
            aria-label={`Color ${color}`}
            aria-pressed={company.color === color}
            className="size-5 rounded-full ring-offset-2 ring-offset-background aria-pressed:ring-2 aria-pressed:ring-foreground"
            style={{ backgroundColor: color }}
            onClick={() => update({ color })}
          />
        ))}
        <input
          type="color"
          aria-label="Custom color"
          className="size-6 cursor-pointer rounded border-0 bg-transparent p-0"
          value={company.color}
          onChange={(event) => update({ color: event.target.value })}
        />
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="w-12 shrink-0">Repo</span>
        <select
          aria-label="Repository"
          className={SELECT_CLASS}
          value={company.projectRef ? scopedProjectKey(company.projectRef) : ""}
          onChange={(event) => {
            const project = projects.find(
              (entry) =>
                scopedProjectKey(scopeProjectRef(entry.environmentId, entry.id)) ===
                event.target.value,
            );
            update({
              projectRef: project ? scopeProjectRef(project.environmentId, project.id) : null,
              modelSelection: null,
            });
          }}
        >
          <option value="">No repository</option>
          {projects.map((project) => {
            const key = scopedProjectKey(scopeProjectRef(project.environmentId, project.id));
            return (
              <option key={key} value={key}>
                {project.title} — {project.workspaceRoot}
              </option>
            );
          })}
        </select>
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="w-12 shrink-0">Agent</span>
        <select
          aria-label="Agent"
          className={SELECT_CLASS}
          disabled={company.projectRef === null}
          value={company.modelSelection?.instanceId ?? ""}
          onChange={(event) => {
            const instanceId = event.target.value as ProviderInstanceId;
            const model = instanceId
              ? getDefaultProviderInstanceModel(providers, instanceId)
              : undefined;
            const modelSelection: ModelSelection | null =
              instanceId && model ? { instanceId, model } : null;
            update({ modelSelection });
          }}
        >
          <option value="">Project default</option>
          {providerEntries.map((entry) => (
            <option key={entry.instanceId} value={entry.instanceId}>
              {entry.displayName}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

/** Add, rename, recolor, and bind companies to a repository and a default agent. */
export function CompaniesDialog() {
  const open = useCompaniesDialog((state) => state.open);
  const setOpen = useCompaniesDialog((state) => state.setOpen);
  const companies = useMosaicStore((state) => state.companies);
  const upsertCompany = useMosaicStore((state) => state.upsertCompany);
  const [draftName, setDraftName] = useState("");

  const addCompany = () => {
    const name = draftName.trim();
    if (!name) return;
    upsertCompany({
      id: randomUUID(),
      name,
      color: COMPANY_COLOR_PALETTE[companies.length % COMPANY_COLOR_PALETTE.length]!,
      projectRef: null,
      modelSelection: null,
    });
    setDraftName("");
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogPopup className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Companies</DialogTitle>
          <DialogDescription>
            Each company has one repository, a default agent for new chats, and a pane color.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto text-sm">
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              addCompany();
            }}
          >
            <Input
              aria-label="New company name"
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              placeholder="Add a company, e.g. DoorDash"
            />
            <Button type="submit" size="sm" disabled={draftName.trim().length === 0}>
              <PlusIcon />
              Add
            </Button>
          </form>
          {companies.map((company) => (
            <CompanyRow key={company.id} company={company} />
          ))}
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
