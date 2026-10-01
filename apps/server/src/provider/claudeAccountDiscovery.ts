/**
 * Find Claude config directories that already finished `claude` login, and
 * describe the provider instances that should represent them.
 *
 * Credential files are read only to decide "logged in" or not. Nothing in the
 * returned plan includes token text, key material, or file contents.
 */
import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderInstanceConfig,
  type ProviderInstanceConfigMap,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { accountLoginTarget } from "./providerAccountLoginSupport.ts";

const decodeUnknownJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));

/** Same variable Settings › Providers stores for an API-key Claude instance. */
export const CLAUDE_API_KEY_VARIABLE = "ANTHROPIC_API_KEY";

/**
 * Arguments for `security find-generic-password`. Exit status is the only
 * signal we use. Do not add `-w` or `-g`; those print the keychain secret.
 */
export const CLAUDE_KEYCHAIN_LOOKUP_ARGS = [
  "find-generic-password",
  "-s",
  "Claude Code-credentials",
] as const;

const CREDENTIALS_MAX_BYTES = 256 * 1024;
const USER_CONFIG_MAX_BYTES = 32 * 1024 * 1024;
const OAUTH_TOKEN_KEYS = ["accessToken", "refreshToken", "token"] as const;
const USER_ACCOUNT_KEYS = ["accountUuid", "emailAddress", "organizationUuid"] as const;

export interface DiscoveredClaudeAccountPlan {
  readonly instanceId: ProviderInstanceId;
  readonly label: string;
  readonly configDir: string;
}

export interface ClaudeAccountDiscovery {
  readonly accounts: ReadonlyArray<DiscoveredClaudeAccountPlan>;
  readonly additions: ProviderInstanceConfigMap;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/** `.credentials.json` holds a Claude.ai OAuth token or an API key. */
export function credentialsDocumentLoggedIn(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const oauth = value.claudeAiOauth;
  if (isRecord(oauth) && OAUTH_TOKEN_KEYS.some((key) => nonEmptyString(oauth[key]))) {
    return true;
  }
  return nonEmptyString(value.primaryApiKey) || nonEmptyString(value.apiKey);
}

/**
 * `~/.claude.json` records the default directory's completed login. Only the
 * presence of account identifiers is checked; those fields are not returned.
 */
export function claudeUserConfigLoggedIn(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (nonEmptyString(value.primaryApiKey)) return true;
  const oauth = value.oauthAccount;
  if (!isRecord(oauth)) return false;
  return USER_ACCOUNT_KEYS.some((key) => nonEmptyString(oauth[key]));
}

/** `.claude` is the default login. `.claude_motley_fool` is "Motley Fool". */
export function claudeFolderLabel(dirName: string): string {
  if (dirName === ".claude") return "default";
  const raw = dirName.startsWith(".claude_") ? dirName.slice(".claude_".length) : dirName;
  const words = raw.split(/[^A-Za-z0-9]+/).filter((word) => word.length > 0);
  if (words.length === 0) return "Claude";
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

export function isClaudeConfigDirName(name: string): boolean {
  return name === ".claude" || /^\.claude_[A-Za-z0-9]/.test(name);
}

function readConfigString(config: unknown, key: string): string {
  if (!isRecord(config)) return "";
  const value = config[key];
  return typeof value === "string" ? value.trim() : "";
}

const fileIndicatesLogin = Effect.fn("claudeAccountDiscovery.fileIndicatesLogin")(function* (
  filePath: string,
  maxBytes: number,
  loggedIn: (value: unknown) => boolean,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const info = yield* fileSystem.stat(filePath).pipe(Effect.option);
  if (Option.isNone(info) || info.value.type !== "File" || Number(info.value.size) > maxBytes) {
    return false;
  }
  const text = yield* fileSystem.readFileString(filePath).pipe(Effect.option);
  if (Option.isNone(text)) return false;
  const parsed = yield* decodeUnknownJson(text.value).pipe(Effect.option);
  if (Option.isNone(parsed)) return false;
  return loggedIn(parsed.value);
});

/**
 * Whether this config directory has a completed Claude login.
 * The default `~/.claude` also counts a macOS keychain item or `~/.claude.json`
 * account record. Other directories count only their own `.credentials.json`.
 */
export const claudeConfigDirLoggedIn = Effect.fn("claudeConfigDirLoggedIn")(function* (input: {
  readonly homeDir: string;
  readonly absolutePath: string;
  readonly defaultKeychainLoggedIn: boolean;
}) {
  const path = yield* Path.Path;
  const absolutePath = path.resolve(input.absolutePath);
  if (
    yield* fileIndicatesLogin(
      path.join(absolutePath, ".credentials.json"),
      CREDENTIALS_MAX_BYTES,
      credentialsDocumentLoggedIn,
    )
  ) {
    return true;
  }
  const isDefault = absolutePath === path.resolve(path.join(input.homeDir, ".claude"));
  if (!isDefault) return false;
  if (input.defaultKeychainLoggedIn) return true;
  return yield* fileIndicatesLogin(
    path.join(input.homeDir, ".claude.json"),
    USER_CONFIG_MAX_BYTES,
    claudeUserConfigLoggedIn,
  );
});

function candidateInstanceIds(dirName: string, label: string): ReadonlyArray<ProviderInstanceId> {
  if (dirName === ".claude") {
    return [ProviderInstanceId.make("claudeAgent"), ProviderInstanceId.make("claudeAgent_default")];
  }
  const target = accountLoginTarget("claudeAgent", label);
  if (!target) return [];
  const alternate = `${target.instanceId}_2`;
  return alternate.length <= 64
    ? [target.instanceId, ProviderInstanceId.make(alternate)]
    : [target.instanceId];
}

/**
 * Config directories that already have a Claude login, plus provider-instance
 * additions for any directory T3 does not already point at.
 */
export const discoverClaudeConfigAccounts = Effect.fn("discoverClaudeConfigAccounts")(
  function* (input: {
    readonly homeDir: string;
    readonly instances: ProviderInstanceConfigMap;
    /** macOS keychain item for the default `~/.claude` login. Not a credential. */
    readonly defaultKeychainLoggedIn: boolean;
  }) {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const homeDir = path.resolve(input.homeDir);

    const resolveConfigured = (homePath: string) => {
      const trimmed = homePath.trim();
      if (trimmed.length === 0 || trimmed === "~") {
        return trimmed.length === 0 ? path.resolve(path.join(homeDir, ".claude")) : homeDir;
      }
      if (trimmed.startsWith("~/")) return path.resolve(path.join(homeDir, trimmed.slice(2)));
      return path.resolve(trimmed);
    };

    const present = (absolutePath: string) => {
      const relative = path.relative(homeDir, absolutePath);
      if (relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative)) {
        const portable = relative.split(path.sep).join("/");
        return { dirName: portable, homePath: `~/${portable}` };
      }
      return { dirName: path.basename(absolutePath), homePath: absolutePath };
    };

    const directoryLoggedIn = (absolutePath: string) =>
      claudeConfigDirLoggedIn({
        homeDir,
        absolutePath,
        defaultKeychainLoggedIn: input.defaultKeychainLoggedIn,
      });

    const candidates = new Map<string, { readonly dirName: string; readonly homePath: string }>();
    const addCandidate = (absolutePath: string) => {
      const resolved = path.resolve(absolutePath);
      if (resolved === homeDir || resolved === path.parse(resolved).root) return;
      if (candidates.has(resolved)) return;
      candidates.set(resolved, present(resolved));
    };

    const childNames = yield* fileSystem
      .readDirectory(homeDir)
      .pipe(Effect.orElseSucceed(() => []));
    for (const name of childNames) {
      if (!isClaudeConfigDirName(name)) continue;
      const absolutePath = path.join(homeDir, name);
      const info = yield* fileSystem.stat(absolutePath).pipe(Effect.option);
      if (Option.isSome(info) && info.value.type === "Directory") addCandidate(absolutePath);
    }
    addCandidate(path.join(homeDir, ".claude"));

    const claudeInstances = Object.entries(input.instances).flatMap(([instanceId, instance]) =>
      instance.driver === "claudeAgent" ? [{ instanceId, instance }] : [],
    );

    for (const { instance } of claudeInstances) {
      const homePath = readConfigString(instance.config, "homePath");
      if (homePath.length > 0) addCandidate(resolveConfigured(homePath));
      for (const variable of instance.environment ?? []) {
        if (variable.name === "CLAUDE_CONFIG_DIR" && variable.value.trim().length > 0) {
          addCandidate(resolveConfigured(variable.value));
        }
      }
    }

    const effectiveHome = (instance: ProviderInstanceConfig) => {
      const homePath = readConfigString(instance.config, "homePath");
      if (homePath.length > 0) return resolveConfigured(homePath);
      const fromEnv =
        instance.environment
          ?.find((variable) => variable.name === "CLAUDE_CONFIG_DIR")
          ?.value.trim() ?? "";
      return resolveConfigured(fromEnv);
    };

    const located = claudeInstances.map(({ instanceId, instance }) => ({
      instanceId,
      absolutePath: effectiveHome(instance),
    }));

    const defaultBinaryPath = readConfigString(
      input.instances[ProviderInstanceId.make("claudeAgent")]?.config,
      "binaryPath",
    );

    const accounts: DiscoveredClaudeAccountPlan[] = [];
    const additions: Record<string, ProviderInstanceConfig> = {};

    for (const [absolutePath, presented] of candidates) {
      if (!(yield* directoryLoggedIn(absolutePath))) continue;
      const label = claudeFolderLabel(presented.dirName);
      const existing = located.find((entry) => entry.absolutePath === absolutePath);
      let instanceId: ProviderInstanceId | undefined;
      let write = false;
      if (existing) {
        instanceId = ProviderInstanceId.make(existing.instanceId);
      } else {
        for (const candidate of candidateInstanceIds(presented.dirName, label)) {
          const taken = located.find((entry) => entry.instanceId === candidate);
          if (!taken) {
            instanceId = candidate;
            write = true;
            break;
          }
          if (taken.absolutePath === absolutePath) {
            instanceId = candidate;
            break;
          }
        }
      }
      if (!instanceId) continue;
      accounts.push({ instanceId, label, configDir: presented.homePath });
      if (!write) continue;
      additions[instanceId] = {
        driver: ProviderDriverKind.make("claudeAgent"),
        enabled: true,
        displayName: label,
        config: {
          homePath: presented.homePath,
          ...(defaultBinaryPath.length > 0 ? { binaryPath: defaultBinaryPath } : {}),
        },
      };
      located.push({ instanceId, absolutePath });
    }

    accounts.sort((left, right) => {
      if (left.configDir === "~/.claude") return -1;
      if (right.configDir === "~/.claude") return 1;
      return left.label.localeCompare(right.label);
    });

    return {
      accounts,
      additions: additions as ProviderInstanceConfigMap,
    } satisfies ClaudeAccountDiscovery;
  },
);
