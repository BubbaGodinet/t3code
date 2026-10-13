import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import type {
  DiscoveredClaudeAccount,
  EnvironmentId,
  ProviderAccountLoginDriver,
  ProviderInstanceId,
  ServerProvider,
} from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useEffect, useRef, useState } from "react";

import { writeTextToClipboard } from "../../hooks/useCopyToClipboard";
import { ensureLocalApi } from "../../localApi";
import { cn } from "../../lib/utils";
import { useEnvironmentQuery } from "../../state/query";
import { environmentServerConfigsAtom, serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { ClaudeAI, OpenAI, type Icon } from "../Icons";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";

const DRIVERS: ReadonlyArray<{
  readonly value: ProviderAccountLoginDriver;
  readonly label: string;
  readonly icon: Icon;
}> = [
  { value: "claudeAgent", label: "Claude", icon: ClaudeAI },
  { value: "codex", label: "Codex", icon: OpenAI },
];

type ClaudeAccess = "console" | "web";

const COMMAND_OPTIONS = { reportFailure: false, reportDefect: false };

/**
 * Signs another Claude or Codex account in. Claude can use the terminal console
 * (`claude auth login --console`) or the browser sign-in page. Also lists Claude
 * config directories that already have a login.
 */
export function AddAccountDialog(props: {
  readonly environmentId: EnvironmentId;
  readonly initialDriver?: ProviderAccountLoginDriver | undefined;
  readonly onOpenChange: (open: boolean) => void;
  /** Runs once the new account appears in the environment's providers. */
  readonly onAdded?:
    | ((instanceId: ProviderInstanceId, providers: ReadonlyArray<ServerProvider>) => void)
    | undefined;
}) {
  const { environmentId, onAdded, onOpenChange } = props;
  const [driver, setDriver] = useState<ProviderAccountLoginDriver>(
    props.initialDriver ?? "claudeAgent",
  );
  const [access, setAccess] = useState<ClaudeAccess>("console");
  const [label, setLabel] = useState("");
  const [flowId, setFlowId] = useState<string | null>(null);
  const [savedKey, setSavedKey] = useState<{
    instanceId: ProviderInstanceId;
    label: string;
    configDir: string;
  } | null>(null);
  const [discovered, setDiscovered] = useState<ReadonlyArray<DiscoveredClaudeAccount>>([]);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const addedRef = useRef<string | null>(null);

  const startLogin = useAtomCommand(serverEnvironment.startProviderAccountLogin, COMMAND_OPTIONS);
  const submitCode = useAtomCommand(
    serverEnvironment.submitProviderAccountLoginCode,
    COMMAND_OPTIONS,
  );
  const cancelLogin = useAtomCommand(serverEnvironment.cancelProviderAccountLogin, COMMAND_OPTIONS);
  const discoverAccounts = useAtomCommand(
    serverEnvironment.discoverProviderAccounts,
    COMMAND_OPTIONS,
  );
  const loginQuery = useEnvironmentQuery(
    flowId
      ? serverEnvironment.providerAccountLoginState({ environmentId, input: { flowId } })
      : null,
  );
  const login = loginQuery.data;
  const providers = useAtomValue(environmentServerConfigsAtom).get(environmentId)?.providers;
  const active =
    flowId !== null &&
    loginQuery.error === null &&
    (login === null || login.phase === "starting" || login.phase === "waiting");
  const pendingInstanceId =
    login?.phase === "succeeded" ? login.instanceId : (savedKey?.instanceId ?? null);
  const listed =
    pendingInstanceId !== null &&
    (providers ?? []).some((provider) => provider.instanceId === pendingInstanceId);
  const driverName = DRIVERS.find((entry) => entry.value === (login?.driver ?? driver))?.label;
  const consoleLogin = driver === "claudeAgent" && access === "console";

  useEffect(() => {
    let cancelled = false;
    void discoverAccounts({ environmentId, input: {} }).then((result) => {
      if (cancelled || result._tag !== "Success") return;
      setDiscovered(result.value.accounts);
    });
    return () => {
      cancelled = true;
    };
  }, [discoverAccounts, environmentId]);

  useEffect(() => {
    if (!listed || !pendingInstanceId || !providers || addedRef.current === pendingInstanceId) {
      return;
    }
    addedRef.current = pendingInstanceId;
    onAdded?.(pendingInstanceId, providers);
  }, [listed, onAdded, pendingInstanceId, providers]);

  async function run<A, E>(request: () => Promise<AtomCommandResult<A, E>>): Promise<A | null> {
    if (pendingRef.current) return null;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await request();
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          const failure = squashAtomCommandFailure(result);
          setError(failure instanceof Error ? failure.message : "Sign-in failed. Try again.");
        }
        return null;
      }
      return result.value;
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  async function start() {
    const trimmed = label.trim();
    if (!trimmed) return;
    const state = await run(() =>
      startLogin({
        environmentId,
        input: {
          driver,
          label: trimmed,
          ...(driver === "claudeAgent" ? { claudeLogin: access } : {}),
        },
      }),
    );
    if (state) setFlowId(state.flowId);
  }

  async function sendCode() {
    if (!flowId || !code.trim()) return;
    const sent = await run(() =>
      submitCode({ environmentId, input: { flowId, code: code.trim() } }),
    );
    if (sent) setCode("");
  }

  function selectDiscovered(account: DiscoveredClaudeAccount) {
    const current = providers ?? [];
    if (current.some((provider) => provider.instanceId === account.instanceId)) {
      onAdded?.(account.instanceId, current);
      onOpenChange(false);
      return;
    }
    setSavedKey({
      instanceId: account.instanceId,
      label: account.label,
      configDir: account.configDir,
    });
  }

  function cancel() {
    if (flowId && active) void cancelLogin({ environmentId, input: { flowId } });
  }

  function close() {
    cancel();
    onOpenChange(false);
  }

  function restart() {
    setFlowId(null);
    setSavedKey(null);
    setCode("");
    setError(null);
    addedRef.current = null;
  }

  function chooseDriver(next: ProviderAccountLoginDriver) {
    setDriver(next);
    if (next !== "claudeAgent") setAccess("console");
  }

  async function openSignInPage(url: string) {
    try {
      await ensureLocalApi().shell.openExternal(url);
    } catch {
      setError("Could not open the sign-in page. Copy the link into your browser.");
    }
  }

  async function copySignInLink(url: string) {
    try {
      await writeTextToClipboard(url, "Sign-in link");
    } catch {
      setError("Could not copy the link. Use Open sign-in page.");
    }
  }

  const finished = login?.phase === "failed" || login?.phase === "cancelled";
  const canSubmit = label.trim().length > 0 && !pending;

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : close())}>
      <DialogPopup className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add account</DialogTitle>
          <DialogDescription>
            Sign in to another Claude or Codex account. Claude can use the terminal console or the
            web sign-in page.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="flex flex-col gap-3 text-sm">
          {flowId === null && savedKey === null ? (
            <form
              id="add-account-form"
              className="flex flex-col gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                void start();
              }}
            >
              <div role="radiogroup" aria-label="Agent" className="grid grid-cols-2 gap-2">
                {DRIVERS.map((entry) => (
                  <button
                    key={entry.value}
                    type="button"
                    role="radio"
                    aria-checked={driver === entry.value}
                    className={cn(
                      "flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left font-medium",
                      driver === entry.value
                        ? "border-primary bg-primary/8 text-foreground ring-1 ring-primary"
                        : "text-muted-foreground hover:bg-accent",
                    )}
                    onClick={() => chooseDriver(entry.value)}
                  >
                    <entry.icon className="size-4 shrink-0" aria-hidden />
                    {entry.label}
                  </button>
                ))}
              </div>
              {driver === "claudeAgent" && discovered.length > 0 ? (
                <div className="flex flex-col gap-2">
                  <span className="text-xs font-medium">Already signed in</span>
                  <ul className="flex flex-col gap-1.5">
                    {discovered.map((account) => (
                      <li
                        key={account.instanceId}
                        className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2"
                      >
                        <span className="min-w-0">
                          <span className="block font-medium">{account.label}</span>
                          <span className="block truncate font-mono text-xs text-muted-foreground">
                            {account.configDir}
                          </span>
                        </span>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => selectDiscovered(account)}
                        >
                          Select
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {driver === "claudeAgent" ? (
                <div
                  role="radiogroup"
                  aria-label="Claude access"
                  className="grid grid-cols-2 gap-2"
                >
                  {(
                    [
                      ["console", "Claude console"],
                      ["web", "Sign in on the web"],
                    ] as const
                  ).map(([value, text]) => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={access === value}
                      className={cn(
                        "rounded-lg border px-3 py-2.5 text-left text-sm font-medium",
                        access === value
                          ? "border-primary bg-primary/8 text-foreground ring-1 ring-primary"
                          : "text-muted-foreground hover:bg-accent",
                      )}
                      onClick={() => setAccess(value)}
                    >
                      {text}
                    </button>
                  ))}
                </div>
              ) : null}
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium">Label</span>
                <Input
                  autoFocus
                  value={label}
                  maxLength={64}
                  onChange={(event) => setLabel(event.target.value)}
                  placeholder="e.g. DoorDash, Motley Fool, Personal"
                  disabled={pending}
                />
              </label>
              {consoleLogin ? (
                <p className="text-xs text-muted-foreground">
                  Runs <span className="font-mono">claude auth login --console</span> in this
                  window. Finish the prompts here. A browser page will not be opened.
                </p>
              ) : driver === "claudeAgent" ? (
                <p className="text-xs text-muted-foreground">
                  Opens Claude&apos;s web sign-in page. Finish there, then paste any code it shows.
                </p>
              ) : null}
            </form>
          ) : savedKey !== null && flowId === null ? (
            <div className="flex flex-col gap-2" aria-live="polite">
              <p role="status">
                {listed
                  ? `${savedKey.label} is one of your Claude accounts.`
                  : `Adding ${savedKey.label} to your accounts…`}
              </p>
              <p className="text-xs text-muted-foreground">Folder: {savedKey.configDir}</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3" aria-live="polite">
              <p role="status" className={cn(finished && "text-destructive")}>
                {login?.message ?? `Starting ${driverName} sign-in.`}
              </p>
              {login?.driver === "claudeAgent" && login.transcript ? (
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg border bg-muted/30 p-3 font-mono text-xs text-foreground">
                  {login.transcript}
                </pre>
              ) : null}
              {login?.phase === "waiting" && login.driver === "claudeAgent" && !login.loginUrl ? (
                <p className="text-xs text-muted-foreground">
                  Answer the console below and press Send. This sign-in does not open a browser
                  page.
                </p>
              ) : null}
              {login?.phase === "waiting" && login.loginUrl ? (
                <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground">
                    A browser window should open. If it didn&apos;t, open the sign-in page and
                    finish there.
                  </p>
                  <p className="truncate font-mono text-xs text-muted-foreground">
                    {login.loginUrl}
                  </p>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => void openSignInPage(login.loginUrl!)}>
                      Open sign-in page
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void copySignInLink(login.loginUrl!)}
                    >
                      Copy link
                    </Button>
                  </div>
                </div>
              ) : null}
              {login?.phase === "waiting" && login.userCode ? (
                <p>
                  Enter this code on the sign-in page:{" "}
                  <span className="font-mono text-base font-semibold">{login.userCode}</span>
                </p>
              ) : null}
              {login?.phase === "waiting" && login.driver === "claudeAgent" ? (
                <form
                  className="flex items-center gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void sendCode();
                  }}
                >
                  <Input
                    aria-label="Sign-in code"
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    placeholder="Type the console's answer, then Send"
                    disabled={pending}
                  />
                  <Button type="submit" size="sm" disabled={pending || !code.trim()}>
                    Send
                  </Button>
                </form>
              ) : null}
              {login?.phase === "succeeded" && !listed ? (
                <p className="text-xs text-muted-foreground">Adding it to your accounts…</p>
              ) : null}
              {login ? (
                <p className="text-xs text-muted-foreground">Folder: {login.configDir}</p>
              ) : null}
            </div>
          )}
          {(error ?? loginQuery.error) ? (
            <p className="text-xs text-destructive">{error ?? loginQuery.error}</p>
          ) : null}
        </DialogPanel>
        <DialogFooter>
          {flowId === null && savedKey === null ? (
            <>
              <Button variant="outline" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" form="add-account-form" disabled={!canSubmit}>
                Sign in
              </Button>
            </>
          ) : active ? (
            <Button variant="outline" onClick={cancel}>
              Cancel sign-in
            </Button>
          ) : finished || loginQuery.error ? (
            <>
              <Button variant="outline" onClick={close}>
                Close
              </Button>
              <Button onClick={restart}>Try again</Button>
            </>
          ) : (
            <Button onClick={close}>Done</Button>
          )}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
