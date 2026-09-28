import {
  ProviderAccountLoginError,
  type ProviderAccountLoginDriver,
  ProviderInstanceId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";

const CONFIG_DIR_PREFIX: Record<ProviderAccountLoginDriver, string> = {
  claudeAgent: ".claude",
  codex: ".codex",
};

/** Same rule as Settings › Add provider, so both flows derive the same instance id. */
export function slugifyAccountLabel(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

export interface AccountLoginTarget {
  readonly instanceId: ProviderInstanceId;
  /** Directory name under the user's home, e.g. `.claude_doordash`. */
  readonly dirName: string;
}

/** "DoorDash" on Claude becomes instance `claudeAgent_doordash` in `~/.claude_doordash`. */
export function accountLoginTarget(
  driver: ProviderAccountLoginDriver,
  label: string,
): AccountLoginTarget | null {
  const slug = slugifyAccountLabel(label);
  if (slug.length === 0) return null;
  return {
    instanceId: ProviderInstanceId.make(`${driver}_${slug}`),
    dirName: `${CONFIG_DIR_PREFIX[driver]}_${slug}`,
  };
}

/**
 * Create `<homeDir>/<dirName>` for a new login. An existing directory is never
 * reused: it may hold another account's credentials.
 */
export const createAccountConfigDir = Effect.fn("createAccountConfigDir")(function* (
  homeDir: string,
  dirName: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = path.join(homeDir, dirName);
  yield* fileSystem.makeDirectory(directory, { mode: 0o700 }).pipe(
    Effect.mapError(
      (error) =>
        new ProviderAccountLoginError({
          detail:
            error instanceof PlatformError.PlatformError && error.reason._tag === "AlreadyExists"
              ? `~/${dirName} already exists. Use another label, or add that folder in Settings › Providers.`
              : `Could not create ~/${dirName}.`,
        }),
    ),
  );
  return directory;
});

// OSC sequences (the CLIs wrap links in OSC 8 hyperlinks) and CSI colour/cursor codes.
// eslint-disable-next-line no-control-regex
const TERMINAL_ESCAPES = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b\[[0-?]*[ -/]*[@-~]/g;

export function stripTerminalEscapes(text: string): string {
  return text.replace(TERMINAL_ESCAPES, "");
}

/**
 * The sign-in link and device code a login CLI printed. Only complete lines
 * are read so a link split across output chunks is never cut short.
 */
export function parseLoginOutput(output: string): {
  readonly loginUrl: string | null;
  readonly userCode: string | null;
} {
  const complete = stripTerminalEscapes(output.slice(0, output.lastIndexOf("\n") + 1));
  const loginUrl = complete.match(/https:\/\/[^\s"'<>]+/)?.[0] ?? null;
  const userCode = complete.match(/code[^\n]*\n?\s*\b([A-Z0-9]{4,5}-[A-Z0-9]{4,5})\b/)?.[1] ?? null;
  return { loginUrl, userCode };
}

/** The CLI's last message, safe to show: no links, no token-like strings. */
export function loginFailureLine(output: string): string | null {
  const lines = stripTerminalEscapes(output)
    .split(/\r?\n/)
    // Claude's prompt has no newline, so whatever it prints next shares its line.
    .map((line) => line.replace(/^\s*paste code here if prompted >/i, "").trim())
    .filter((line) => line.length > 0 && !/https?:\/\//.test(line));
  const last = lines.at(-1);
  if (!last || last.length > 200) return null;
  return last.replace(/[A-Za-z0-9_\-.]{32,}/g, "[redacted]");
}
