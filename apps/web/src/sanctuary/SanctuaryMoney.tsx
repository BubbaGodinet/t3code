import { RefreshCwIcon, XIcon } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";

import { cn } from "../lib/utils";
import { netWorth, newId, type ManualAccount } from "./sanctuaryModel";
import { sanctuaryDesktop, useSanctuaryStore } from "./sanctuaryStore";
import {
  EmptyNote,
  SanctuaryButton,
  SanctuaryDetail,
  SectionTitle,
  fieldClass,
  formatMoney,
  glassTile,
  openExternal,
} from "./SanctuaryUi";

const STALE_AFTER_MS = 6 * 60 * 60 * 1000;

/** Syncs SimpleFIN balances into the document. Resolves to an error message, if any. */
export async function syncSimplefin(): Promise<string | null> {
  const bridge = sanctuaryDesktop();
  if (!bridge) return "SimpleFIN connects from the ARGUS desktop app.";
  const result = await bridge.simplefinAccounts();
  if (!result.ok) return result.errors[0] ?? "Could not reach SimpleFIN.";
  useSanctuaryStore.getState().update((document) => ({
    ...document,
    money: { ...document.money, linked: [...result.accounts], syncedAt: new Date().toISOString() },
  }));
  return result.errors[0] ?? null;
}

function syncedLabel(syncedAt: string | null): string {
  if (!syncedAt) return "Not synced yet";
  const minutes = Math.round((Date.now() - new Date(syncedAt).getTime()) / 60_000);
  if (minutes < 1) return "Synced just now";
  if (minutes < 60) return `Synced ${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Synced ${hours} h ago`;
  return `Synced ${new Date(syncedAt).toLocaleDateString()}`;
}

/** Net worth from SimpleFIN accounts plus anything it cannot see, entered by hand. */
export function SanctuaryMoney({ onBack }: { onBack: () => void }) {
  const money = useSanctuaryStore((state) => state.document.money);
  const connected = useSanctuaryStore((state) => state.capabilities.simplefinConnected);
  const refreshCapabilities = useSanctuaryStore((state) => state.refreshCapabilities);
  const update = useSanctuaryStore((state) => state.update);
  const desktop = sanctuaryDesktop() !== undefined;
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const worth = netWorth(money);

  const refresh = useCallback(async () => {
    setBusy(true);
    setNotice(await syncSimplefin());
    setBusy(false);
  }, []);

  const syncedAt = useRef(money.syncedAt);
  useEffect(() => {
    syncedAt.current = money.syncedAt;
  }, [money.syncedAt]);
  useEffect(() => {
    const last = syncedAt.current;
    const stale = !last || Date.now() - new Date(last).getTime() > STALE_AFTER_MS;
    if (connected && stale) void refresh();
  }, [connected, refresh]);

  const connect = async (event: FormEvent) => {
    event.preventDefault();
    const bridge = sanctuaryDesktop();
    if (!bridge || !token.trim()) return;
    setBusy(true);
    setNotice(null);
    const result = await bridge.connectSimplefin(token.trim());
    setToken("");
    if (!result.ok) {
      setNotice(result.error ?? "Could not connect to SimpleFIN.");
      setBusy(false);
      return;
    }
    await refreshCapabilities();
    setNotice(await syncSimplefin());
    setBusy(false);
  };

  const disconnect = async () => {
    await sanctuaryDesktop()?.disconnectSimplefin();
    update((document) => ({
      ...document,
      money: { ...document.money, linked: [], syncedAt: null },
    }));
    await refreshCapabilities();
    setNotice("SimpleFIN disconnected. Its saved access was deleted from this Mac.");
  };

  return (
    <SanctuaryDetail title="Money" onBack={onBack}>
      <div className="mx-auto max-w-3xl">
        <div className={cn(glassTile, "px-6 py-5")}>
          <p className="text-xs text-ink/75">Net worth</p>
          <p className="mt-1 text-4xl font-medium text-ink tabular-nums">
            {formatMoney(worth.total)}
          </p>
          <p className="mt-2 text-sm text-ink/75 tabular-nums">
            {formatMoney(worth.assets)} assets · {formatMoney(worth.debts)} debts
          </p>
        </div>
        <p className="mt-2 text-xs text-ink/60">Read and understand. ARGUS never moves money.</p>

        <SectionTitle
          action={
            connected ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-ink/75">{syncedLabel(money.syncedAt)}</span>
                <SanctuaryButton onClick={() => void refresh()} disabled={busy} label="Refresh">
                  <RefreshCwIcon className={cn("size-3.5", busy && "opacity-50")} />
                </SanctuaryButton>
                <SanctuaryButton tone="danger" onClick={() => void disconnect()}>
                  Disconnect
                </SanctuaryButton>
              </div>
            ) : null
          }
        >
          Linked accounts
        </SectionTitle>
        {connected ? (
          money.linked.length === 0 ? (
            <EmptyNote>
              {busy ? "Syncing with SimpleFIN…" : "SimpleFIN returned no accounts yet."}
            </EmptyNote>
          ) : (
            <ul className="divide-y divide-ink/10">
              {money.linked.map((account) => (
                <li key={account.id} className="flex items-center justify-between py-2.5 text-sm">
                  <span>
                    <span className="block text-ink">{account.name}</span>
                    <span className="text-xs text-ink/75">{account.org}</span>
                  </span>
                  <span
                    className={cn("tabular-nums", account.balance < 0 ? "text-ink/85" : "text-ink")}
                  >
                    {formatMoney(account.balance)}
                  </span>
                </li>
              ))}
            </ul>
          )
        ) : desktop ? (
          <form onSubmit={(event) => void connect(event)} className="space-y-3">
            <p className="text-sm leading-6 text-ink/85">
              Connect banks and cards read-only through SimpleFIN Bridge. Create a setup token in
              your SimpleFIN account, then paste it here. ARGUS trades it for access once and keeps
              that encrypted on this Mac.
            </p>
            <div className="flex gap-2">
              <input
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder="Paste SimpleFIN setup token"
                autoComplete="off"
                spellCheck={false}
                className={cn(fieldClass, "min-w-0 flex-1 font-mono text-xs")}
              />
              <SanctuaryButton type="submit" tone="solid" disabled={busy || !token.trim()}>
                {busy ? "Connecting…" : "Connect"}
              </SanctuaryButton>
            </div>
            <button
              type="button"
              onClick={() => openExternal("https://beta-bridge.simplefin.org/")}
              className="text-xs text-ink/75 underline-offset-4 hover:text-ink hover:underline"
            >
              Get a SimpleFIN setup token
            </button>
          </form>
        ) : (
          <EmptyNote>
            SimpleFIN connects from the ARGUS desktop app. Manual accounts work here.
          </EmptyNote>
        )}
        {notice ? <p className="mt-3 text-sm text-amber-800">{notice}</p> : null}

        <SectionTitle>Assets and debts you add</SectionTitle>
        <ManualAccounts />
      </div>
    </SanctuaryDetail>
  );
}

function ManualAccounts() {
  const manual = useSanctuaryStore((state) => state.document.money.manual);
  const update = useSanctuaryStore((state) => state.update);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ManualAccount["kind"]>("asset");
  const [amount, setAmount] = useState("");

  const setManual = (change: (accounts: readonly ManualAccount[]) => readonly ManualAccount[]) =>
    update((document) => ({
      ...document,
      money: { ...document.money, manual: change(document.money.manual) },
    }));

  const add = (event: FormEvent) => {
    event.preventDefault();
    const value = Math.abs(Number(amount.replace(/[$,\s]/g, "")));
    if (!name.trim() || !Number.isFinite(value)) return;
    setManual((accounts) => [...accounts, { id: newId(), name: name.trim(), kind, amount: value }]);
    setName("");
    setAmount("");
  };

  return (
    <>
      {manual.length > 0 ? (
        <ul className="mb-4 divide-y divide-ink/10">
          {manual.map((account) => (
            <li key={account.id} className="group flex items-center gap-3 py-2 text-sm">
              <span className="flex-1 text-ink">{account.name}</span>
              <span className="text-xs text-ink/75">
                {account.kind === "asset" ? "Asset" : "Debt"}
              </span>
              <input
                type="number"
                min={0}
                aria-label={`${account.name} amount`}
                value={account.amount}
                onChange={(event) =>
                  setManual((accounts) =>
                    accounts.map((entry) =>
                      entry.id === account.id
                        ? { ...entry, amount: Math.abs(Number(event.target.value) || 0) }
                        : entry,
                    ),
                  )
                }
                className="h-8 w-32 rounded-md bg-transparent px-1.5 text-right text-ink tabular-nums outline-none hover:bg-white/35 focus:bg-white/50"
              />
              <button
                type="button"
                aria-label="Remove"
                onClick={() =>
                  setManual((accounts) => accounts.filter((entry) => entry.id !== account.id))
                }
                className="rounded p-1 text-ink/60 hover:text-ink"
              >
                <XIcon className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-3 text-sm text-ink/75">
          Add what SimpleFIN cannot see: your home, a car, an Apple Card balance, a loan.
        </p>
      )}
      <form onSubmit={add} className="flex flex-wrap gap-2">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Home, Car, Apple Card…"
          className={cn(fieldClass, "min-w-0 flex-1")}
        />
        <select
          value={kind}
          onChange={(event) => setKind(event.target.value as ManualAccount["kind"])}
          className={cn(fieldClass, "w-28")}
        >
          <option value="asset" className="text-black">
            Asset
          </option>
          <option value="debt" className="text-black">
            Debt
          </option>
        </select>
        <input
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          placeholder="Amount"
          inputMode="decimal"
          className={cn(fieldClass, "w-32 text-right")}
        />
        <SanctuaryButton type="submit" disabled={!name.trim() || !amount.trim()}>
          Add
        </SanctuaryButton>
      </form>
    </>
  );
}
