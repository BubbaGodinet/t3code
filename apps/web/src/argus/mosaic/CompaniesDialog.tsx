import { scopedProjectKey, scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { ProviderDriverKind, ProviderInstanceId, ScopedProjectRef } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import { FolderOpenIcon, PlusIcon, Trash2Icon } from "lucide-react";
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
import { stackedThreadToast, toastManager } from "../../components/ui/toast";
import { isLoopbackHostname } from "../../environments/primary";
import { readLocalApi } from "../../localApi";
import {
  findProjectByPath,
  inferProjectTitleFromPath,
  isExplicitRelativeProjectPath,
  resolveProjectPathForDispatch,
} from "../../lib/projectPaths";
import { newProjectId, randomUUID } from "../../lib/utils";
import { useProjects, waitForProject } from "../../state/entities";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { filesystemEnvironment } from "../../state/filesystem";
import { projectEnvironment } from "../../state/projects";
import { environmentServerConfigsAtom } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  companyAccountEntries,
  companyAccountLabel,
  driverLabel,
  preferredCompanyAccount,
  selectCompanyAccount,
} from "./companyAgent";
import { COMPANY_COLOR_PALETTE, useMosaicStore, type MosaicCompany } from "./mosaicStore";

export const useCompaniesDialog = create<{ open: boolean; setOpen: (open: boolean) => void }>()(
  (set) => ({ open: false, setOpen: (open) => set({ open }) }),
);

const SELECT_CLASS =
  "h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm text-foreground";

function showRepositoryError(description: string) {
  toastManager.add(
    stackedThreadToast({ type: "error", title: "Could not use repository", description }),
  );
}

/**
 * Binds a company to any local directory on the primary environment. Reuses the
 * T3 project already rooted there, otherwise registers one via `project.create`.
 * Typed paths work in every client. Browse opens the native picker on desktop,
 * and in a browser on the server's own Mac it asks the server to show one.
 */
function CompanyRepositoryPathForm(props: {
  readonly onAssign: (projectRef: ScopedProjectRef) => void;
}) {
  const projects = useProjects();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const serverConfigs = useAtomValue(environmentServerConfigsAtom);
  const createProject = useAtomCommand(projectEnvironment.create, { reportFailure: false });
  const pickFolderOnHost = useAtomCommand(filesystemEnvironment.pickFolder, {
    reportFailure: false,
  });
  const [path, setPath] = useState("");
  const [pending, setPending] = useState(false);
  const hasDesktopPicker = typeof window !== "undefined" && window.desktopBridge !== undefined;
  // The host dialog opens on the server's screen, so only a browser on that machine can use it.
  const canPickOnHost =
    primaryEnvironmentId !== null &&
    serverConfigs.get(primaryEnvironmentId)?.environment.platform.os === "darwin" &&
    typeof window !== "undefined" &&
    isLoopbackHostname(window.location.hostname);
  const canPickFolder = hasDesktopPicker || canPickOnHost;

  const assignPath = async (rawPath: string) => {
    if (primaryEnvironmentId === null) {
      showRepositoryError("No local T3 server is connected.");
      return;
    }
    if (isExplicitRelativeProjectPath(rawPath.trim())) {
      showRepositoryError("Enter an absolute path, e.g. ~/code/my-repo.");
      return;
    }
    const workspaceRoot = resolveProjectPathForDispatch(rawPath);
    if (workspaceRoot.length === 0) return;

    const existing = findProjectByPath(
      projects.filter((project) => project.environmentId === primaryEnvironmentId),
      workspaceRoot,
    );
    if (existing) {
      props.onAssign(scopeProjectRef(existing.environmentId, existing.id));
      setPath("");
      return;
    }

    setPending(true);
    const projectId = newProjectId();
    const result = await createProject({
      environmentId: primaryEnvironmentId,
      input: {
        projectId,
        title: inferProjectTitleFromPath(workspaceRoot),
        workspaceRoot,
        createWorkspaceRootIfMissing: false,
        defaultModelSelection: null,
      },
    });
    setPending(false);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        showRepositoryError(error instanceof Error ? error.message : "The folder was rejected.");
      }
      return;
    }
    const projectRef = scopeProjectRef(primaryEnvironmentId, projectId);
    // Let the shell stream deliver the project so the select resolves its label.
    await waitForProject(projectRef, 3_000).catch(() => null);
    props.onAssign(projectRef);
    setPath("");
  };

  const browse = async () => {
    const initialPath = path.trim() || undefined;
    if (hasDesktopPicker) {
      const picked = await readLocalApi()
        ?.dialogs.pickFolder(initialPath ? { initialPath } : undefined)
        .catch(() => null);
      if (picked) await assignPath(picked);
      return;
    }
    if (primaryEnvironmentId === null) return;
    setPending(true);
    const result = await pickFolderOnHost({
      environmentId: primaryEnvironmentId,
      input: initialPath ? { initialPath } : {},
    });
    setPending(false);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        showRepositoryError(error instanceof Error ? error.message : "The folder picker failed.");
      }
      return;
    }
    if (result.value) await assignPath(result.value);
  };

  return (
    <form
      className="flex items-center gap-2 text-xs text-muted-foreground"
      onSubmit={(event) => {
        event.preventDefault();
        void assignPath(path);
      }}
    >
      <span className="w-12 shrink-0" />
      <Input
        aria-label="Repository folder path"
        value={path}
        onChange={(event) => setPath(event.target.value)}
        placeholder="Any local folder, e.g. ~/code/my-repo"
        disabled={pending}
      />
      {canPickFolder ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => void browse()}
        >
          <FolderOpenIcon />
          Browse
        </Button>
      ) : null}
      <Button type="submit" size="sm" disabled={pending || path.trim().length === 0}>
        Use
      </Button>
    </form>
  );
}

function CompanyRow({ company }: { company: MosaicCompany }) {
  const upsertCompany = useMosaicStore((state) => state.upsertCompany);
  const removeCompany = useMosaicStore((state) => state.removeCompany);
  const projects = useProjects();
  const serverConfigs = useAtomValue(environmentServerConfigsAtom);
  const providers = company.projectRef
    ? (serverConfigs.get(company.projectRef.environmentId)?.providers ?? [])
    : [];
  const setDialogOpen = useCompaniesDialog((state) => state.setOpen);
  const navigate = useNavigate();
  const accountEntries = companyAccountEntries(providers);
  const drivers = [...new Set(accountEntries.map((entry) => entry.driverKind))];
  const currentAccount = accountEntries.find(
    (entry) => entry.instanceId === company.modelSelection?.instanceId,
  );
  const currentDriver =
    currentAccount?.driverKind ??
    providers.find((provider) => provider.instanceId === company.modelSelection?.instanceId)
      ?.driver ??
    null;
  const driverAccounts = currentDriver
    ? accountEntries.filter((entry) => entry.driverKind === currentDriver)
    : [];
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
      <CompanyRepositoryPathForm
        onAssign={(projectRef) => {
          const latest = useMosaicStore
            .getState()
            .companies.find((entry) => entry.id === company.id);
          if (latest) upsertCompany({ ...latest, projectRef, modelSelection: null });
        }}
      />
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="w-12 shrink-0">Agent</span>
        <select
          aria-label="Agent"
          className={SELECT_CLASS}
          disabled={company.projectRef === null}
          value={currentDriver ?? ""}
          onChange={(event) => {
            const driver = event.target.value as ProviderDriverKind;
            const account = driver ? preferredCompanyAccount(accountEntries, driver) : undefined;
            update({
              modelSelection: account
                ? selectCompanyAccount(providers, null, account.instanceId)
                : null,
            });
          }}
        >
          <option value="">Project default</option>
          {currentDriver && !drivers.includes(currentDriver) ? (
            <option value={currentDriver}>{driverLabel(currentDriver)} (unavailable)</option>
          ) : null}
          {drivers.map((driver) => (
            <option key={driver} value={driver}>
              {driverLabel(driver)}
            </option>
          ))}
        </select>
      </div>
      {currentDriver ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="w-12 shrink-0">Account</span>
          <select
            aria-label="Account"
            className={SELECT_CLASS}
            value={company.modelSelection?.instanceId ?? ""}
            onChange={(event) =>
              update({
                modelSelection: selectCompanyAccount(
                  providers,
                  company.modelSelection,
                  event.target.value as ProviderInstanceId,
                ),
              })
            }
          >
            {company.modelSelection && !currentAccount ? (
              <option value={company.modelSelection.instanceId}>
                {company.modelSelection.instanceId} (not configured)
              </option>
            ) : null}
            {driverAccounts.map((entry) => (
              <option key={entry.instanceId} value={entry.instanceId}>
                {companyAccountLabel(entry)}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              if (!company.projectRef) return;
              setDialogOpen(false);
              void navigate({
                to: "/settings/providers",
                search: { environmentId: company.projectRef.environmentId },
              });
            }}
          >
            <PlusIcon />
            Add account
          </Button>
        </div>
      ) : null}
      {currentDriver && driverAccounts.length < 2 ? (
        <p className="ps-14 text-xs text-muted-foreground">
          Only one {driverLabel(currentDriver)} account is signed in. Add another in Settings ›
          Providers, then pick it here.
        </p>
      ) : null}
    </div>
  );
}

/** Add, rename, recolor, and bind companies to a repository, agent, and provider account. */
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
            Each company has one repository, a default agent and signed-in account for new chats,
            and a pane color.
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
