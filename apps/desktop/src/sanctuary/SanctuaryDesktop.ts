import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";

import * as Electron from "electron";

/**
 * Sanctuary's personal data, kept in the desktop app's own userData folder and
 * nowhere near T3 home: not state.sqlite, not settings.json, not a thread.
 * The document is owned by the renderer; this side only persists it.
 */
const MAX_DOCUMENT_CHARS = 8 * 1024 * 1024;
const NETWORK_TIMEOUT = "30 seconds";

let writeSequence = 0;

const UnknownFromJsonString = Schema.fromJsonString(Schema.Unknown);
const parseJson = Schema.decodeEffect(UnknownFromJsonString);
const stringifyJson = Schema.encodeEffect(UnknownFromJsonString);

const sanctuaryFile = Effect.fn("sanctuary.file")(function* (name: string) {
  const path = yield* Path.Path;
  return path.join(Electron.app.getPath("userData"), "sanctuary", name);
});

const writeAtomic = Effect.fn("sanctuary.writeAtomic")(function* (
  file: string,
  data: string | Uint8Array,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fs.makeDirectory(path.dirname(file), { recursive: true, mode: 0o700 });
  writeSequence += 1;
  const temporary = `${file}.${writeSequence}.tmp`;
  if (typeof data === "string") {
    yield* fs.writeFileString(temporary, data, { mode: 0o600 });
  } else {
    yield* fs.writeFile(temporary, data, { mode: 0o600 });
  }
  yield* fs.rename(temporary, file);
});

export const loadSanctuaryDocument = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const raw = yield* fs.readFileString(yield* sanctuaryFile("sanctuary.json"));
  return yield* parseJson(raw);
}).pipe(Effect.orElseSucceed(() => null));

export const saveSanctuaryDocument = (document: unknown) =>
  Effect.gen(function* () {
    if (typeof document !== "object" || document === null) return false;
    const serialized = yield* stringifyJson(document);
    if (serialized.length > MAX_DOCUMENT_CHARS) return false;
    yield* writeAtomic(yield* sanctuaryFile("sanctuary.json"), serialized);
    return true;
  }).pipe(Effect.orElseSucceed(() => false));

function claudeKey(): string | undefined {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  return key ? key : undefined;
}

export const sanctuaryCapabilities = (platform: NodeJS.Platform) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const simplefinConnected = yield* fs
      .exists(yield* sanctuaryFile("simplefin.bin"))
      .pipe(Effect.orElseSucceed(() => false));
    return {
      simplefinConnected,
      claude: claudeKey() !== undefined,
      systemDictation: platform === "darwin",
    };
  });

/**
 * Opens macOS dictation on the focused text field. On Apple silicon it runs
 * on-device; the app never sees audio, only the text typed into the field.
 */
export function startSystemDictation(platform: NodeJS.Platform): boolean {
  if (platform !== "darwin") return false;
  Electron.Menu.sendActionToFirstResponder("startDictation:");
  return true;
}

// SimpleFIN Bridge: https://www.simplefin.org/protocol.html
// The access URL carries credentials, so it only ever lives encrypted on disk.

const NOT_A_TOKEN = "That does not look like a SimpleFIN setup token.";

export const connectSimplefin = (setupToken: string) =>
  Effect.gen(function* () {
    const claim = Buffer.from(setupToken.trim(), "base64").toString("utf8").trim();
    if (!URL.canParse(claim)) return { ok: false, error: NOT_A_TOKEN };
    const claimUrl = new URL(claim);
    if (claimUrl.protocol !== "https:") return { ok: false, error: NOT_A_TOKEN };
    if (!Electron.safeStorage.isEncryptionAvailable()) {
      return { ok: false, error: "The system keychain is unavailable, so nothing was saved." };
    }
    const client = yield* HttpClient.HttpClient;
    const response = yield* client
      .execute(HttpClientRequest.post(claimUrl))
      .pipe(Effect.timeout(NETWORK_TIMEOUT));
    if (response.status === 403) {
      return {
        ok: false,
        error: "SimpleFIN says this token was already used. Make a new one and paste it here.",
      };
    }
    if (response.status >= 300) {
      return { ok: false, error: "SimpleFIN did not accept the token." };
    }
    const accessUrl = (yield* response.text).trim();
    if (!URL.canParse(accessUrl) || new URL(accessUrl).protocol !== "https:") {
      return { ok: false, error: "SimpleFIN returned an unexpected response." };
    }
    const encrypted = yield* Effect.try(() => Electron.safeStorage.encryptString(accessUrl));
    yield* writeAtomic(yield* sanctuaryFile("simplefin.bin"), encrypted);
    return { ok: true };
  }).pipe(
    Effect.orElseSucceed(() => ({
      ok: false,
      error: "Could not reach SimpleFIN to claim the token.",
    })),
  );

export const disconnectSimplefin = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  yield* fs.remove(yield* sanctuaryFile("simplefin.bin"), { force: true });
}).pipe(Effect.ignore);

interface SimplefinAccountsBody {
  readonly errors?: unknown;
  readonly accounts?: ReadonlyArray<Record<string, unknown>>;
}

export const fetchSimplefinAccounts = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const secret = yield* fs
    .readFile(yield* sanctuaryFile("simplefin.bin"))
    .pipe(Effect.orElseSucceed(() => null));
  if (!secret) return { ok: false, accounts: [], errors: ["SimpleFIN is not connected."] };
  const url = yield* Effect.try(
    () => new URL(Electron.safeStorage.decryptString(Buffer.from(secret))),
  );
  const username = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  url.username = "";
  url.password = "";
  url.pathname = `${url.pathname.replace(/\/$/, "")}/accounts`;
  url.searchParams.set("balances-only", "1");

  const client = yield* HttpClient.HttpClient;
  const response = yield* client
    .execute(HttpClientRequest.get(url).pipe(HttpClientRequest.basicAuth(username, password)))
    .pipe(Effect.timeout(NETWORK_TIMEOUT));
  if (response.status >= 300) {
    return {
      ok: false,
      accounts: [],
      errors: [
        response.status === 403
          ? "SimpleFIN access was revoked. Connect again with a new setup token."
          : "SimpleFIN could not return accounts right now.",
      ],
    };
  }
  const body = (yield* response.json) as SimplefinAccountsBody | null;
  const accounts = (body?.accounts ?? []).map((account) => ({
    id: String(account.id ?? ""),
    name: String(account.name ?? "Account"),
    org: String((account.org as { name?: unknown } | undefined)?.name ?? ""),
    currency: String(account.currency ?? "USD"),
    balance: Number(account.balance ?? 0) || 0,
    balanceDate: Number(account["balance-date"] ?? 0) || 0,
  }));
  const errors = Array.isArray(body?.errors) ? body.errors.map(String) : [];
  return { ok: true, accounts, errors };
}).pipe(
  Effect.orElseSucceed(() => ({ ok: false, accounts: [], errors: ["Could not reach SimpleFIN."] })),
);

// Optional Claude path. Only runs when ANTHROPIC_API_KEY is already set, and
// only for the two fixed Sanctuary tasks, so the renderer cannot use it as a
// general proxy.

export type SanctuaryAiTask = "food" | "ramble";

const PROMPTS: Record<SanctuaryAiTask, string> = {
  food: [
    "You estimate nutrition from a spoken meal description.",
    'Reply with only JSON: {"items":[{"name":string,"portion":string,"kcal":number,"protein":number,"carbs":number,"fat":number}]}.',
    "Use USDA-style typical values. Grams for macros, rounded to whole numbers. One item per distinct food.",
  ].join(" "),
  ramble: [
    "You sort a personal brain dump. Keep the person's words where possible.",
    'Reply with only JSON: {"onMind":string[],"tasks":string[]}.',
    "tasks are concrete things to do, phrased as short imperatives. onMind is everything else worth remembering: worries, ideas, feelings.",
    "Do not invent anything that was not said.",
  ].join(" "),
};

export const runSanctuaryAi = (task: SanctuaryAiTask, text: string) =>
  Effect.gen(function* () {
    const key = claudeKey();
    if (!key || !text.trim()) return null;
    const client = yield* HttpClient.HttpClient;
    const request = HttpClientRequest.post("https://api.anthropic.com/v1/messages").pipe(
      HttpClientRequest.setHeaders({ "x-api-key": key, "anthropic-version": "2023-06-01" }),
      HttpClientRequest.bodyJsonUnsafe({
        model: process.env.ARGUS_SANCTUARY_CLAUDE_MODEL?.trim() || "claude-haiku-4-5",
        max_tokens: 1024,
        system: PROMPTS[task],
        messages: [{ role: "user", content: text.slice(0, 8000) }],
      }),
    );
    const response = yield* client.execute(request).pipe(Effect.timeout(NETWORK_TIMEOUT));
    if (response.status >= 300) return null;
    const body = (yield* response.json) as {
      content?: Array<{ type: string; text?: string }>;
    } | null;
    const reply = body?.content?.find((part) => part.type === "text")?.text ?? "";
    return yield* parseJson(reply.slice(reply.indexOf("{"), reply.lastIndexOf("}") + 1));
  }).pipe(Effect.orElseSucceed(() => null));
