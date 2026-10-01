import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderInstanceConfig,
  type ProviderInstanceConfigMap,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import {
  CLAUDE_KEYCHAIN_LOOKUP_ARGS,
  claudeFolderLabel,
  claudeUserConfigLoggedIn,
  credentialsDocumentLoggedIn,
  discoverClaudeConfigAccounts,
} from "./claudeAccountDiscovery.ts";

const FIXTURE_TOKEN = "fixture-token-not-a-secret";

function mentions(value: unknown, needle: string): boolean {
  if (typeof value === "string") return value.includes(needle);
  if (Array.isArray(value)) return value.some((entry) => mentions(entry, needle));
  if (typeof value === "object" && value !== null) {
    return Object.values(value).some((entry) => mentions(entry, needle));
  }
  return false;
}

function claudeInstance(homePath: string): ProviderInstanceConfig {
  return {
    driver: ProviderDriverKind.make("claudeAgent"),
    enabled: true,
    config: { homePath },
  };
}

describe("credential signals", () => {
  it("treats an oauth token or api key in the credentials file as logged in", () => {
    expect(credentialsDocumentLoggedIn({})).toBe(false);
    expect(credentialsDocumentLoggedIn({ claudeAiOauth: {} })).toBe(false);
    expect(credentialsDocumentLoggedIn({ claudeAiOauth: { accessToken: "  " } })).toBe(false);
    expect(credentialsDocumentLoggedIn({ claudeAiOauth: { accessToken: FIXTURE_TOKEN } })).toBe(
      true,
    );
    expect(credentialsDocumentLoggedIn({ primaryApiKey: FIXTURE_TOKEN })).toBe(true);
  });

  it("treats the default user config as logged in only when an account id is present", () => {
    expect(claudeUserConfigLoggedIn({})).toBe(false);
    expect(claudeUserConfigLoggedIn({ oauthAccount: {} })).toBe(false);
    expect(claudeUserConfigLoggedIn({ oauthAccount: { accountUuid: "account-1" } })).toBe(true);
  });

  it("labels the default directory and slug folders", () => {
    expect(claudeFolderLabel(".claude")).toBe("default");
    expect(claudeFolderLabel(".claude_motley_fool")).toBe("Motley Fool");
  });

  it("does not ask the keychain to print a secret", () => {
    expect(CLAUDE_KEYCHAIN_LOOKUP_ARGS).not.toContain("-w");
    expect(CLAUDE_KEYCHAIN_LOOKUP_ARGS).not.toContain("-g");
  });
});

it.layer(NodeServices.layer)("discoverClaudeConfigAccounts", (it) => {
  it.effect("adopts a logged-in default directory and ignores an empty sibling", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-claude-discover-" });
      const motley = path.join(home, ".claude_motley_fool");
      yield* fileSystem.makeDirectory(path.join(home, ".claude"));
      yield* fileSystem.makeDirectory(motley);
      yield* fileSystem.writeFileString(
        path.join(home, ".claude.json"),
        '{"oauthAccount":{"accountUuid":"account-1","emailAddress":"a@example.com"}}',
      );

      const discovery = yield* discoverClaudeConfigAccounts({
        homeDir: home,
        instances: {
          [ProviderInstanceId.make("claudeAgent")]: claudeInstance("~/.claude_motley_fool"),
        } as ProviderInstanceConfigMap,
        defaultKeychainLoggedIn: false,
      });

      expect(discovery.accounts).toEqual([
        {
          instanceId: "claudeAgent_default",
          label: "default",
          configDir: "~/.claude",
        },
      ]);
      expect(discovery.additions[ProviderInstanceId.make("claudeAgent_default")]).toMatchObject({
        driver: "claudeAgent",
        displayName: "default",
        config: { homePath: "~/.claude" },
      });
      expect(discovery.additions[ProviderInstanceId.make("claudeAgent")]).toBeUndefined();
      expect(mentions(discovery, "account-1")).toBe(false);
      expect(mentions(discovery, "a@example.com")).toBe(false);
    }).pipe(Effect.scoped),
  );

  it.effect("registers a credentials file and does not treat an empty object as a login", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-claude-discover-" });
      const loggedIn = path.join(home, ".claude_motley_fool");
      const empty = path.join(home, ".claude_personal");
      yield* fileSystem.makeDirectory(loggedIn);
      yield* fileSystem.makeDirectory(empty);
      yield* fileSystem.writeFileString(
        path.join(loggedIn, ".credentials.json"),
        `{"claudeAiOauth":{"accessToken":"${FIXTURE_TOKEN}"}}`,
      );
      yield* fileSystem.writeFileString(path.join(empty, ".credentials.json"), "{}");

      const discovery = yield* discoverClaudeConfigAccounts({
        homeDir: home,
        instances: {} as ProviderInstanceConfigMap,
        defaultKeychainLoggedIn: false,
      });

      expect(discovery.accounts.map((account) => account.configDir)).toEqual([
        "~/.claude_motley_fool",
      ]);
      expect(discovery.accounts[0]).toMatchObject({
        instanceId: "claudeAgent_motley_fool",
        label: "Motley Fool",
      });
      expect(mentions(discovery, FIXTURE_TOKEN)).toBe(false);
    }).pipe(Effect.scoped),
  );

  it.effect("does not add a second instance for a directory T3 already points at", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-claude-discover-" });
      const loggedIn = path.join(home, ".claude_motley_fool");
      yield* fileSystem.makeDirectory(loggedIn);
      yield* fileSystem.writeFileString(
        path.join(loggedIn, ".credentials.json"),
        `{"claudeAiOauth":{"refreshToken":"${FIXTURE_TOKEN}"}}`,
      );

      const discovery = yield* discoverClaudeConfigAccounts({
        homeDir: home,
        instances: {
          [ProviderInstanceId.make("claudeAgent_motley_fool")]:
            claudeInstance("~/.claude_motley_fool"),
        } as ProviderInstanceConfigMap,
        defaultKeychainLoggedIn: false,
      });

      expect(discovery.accounts).toEqual([
        {
          instanceId: "claudeAgent_motley_fool",
          label: "Motley Fool",
          configDir: "~/.claude_motley_fool",
        },
      ]);
      expect(discovery.additions).toEqual({});
      expect(mentions(discovery, FIXTURE_TOKEN)).toBe(false);
    }).pipe(Effect.scoped),
  );

  it.effect("counts the macOS keychain as the default login and not as every folder", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-claude-discover-" });
      yield* fileSystem.makeDirectory(path.join(home, ".claude_motley_fool"));

      const discovery = yield* discoverClaudeConfigAccounts({
        homeDir: home,
        instances: {} as ProviderInstanceConfigMap,
        defaultKeychainLoggedIn: true,
      });

      expect(discovery.accounts.map((account) => account.configDir)).toEqual(["~/.claude"]);
      expect(discovery.additions[ProviderInstanceId.make("claudeAgent")]).toMatchObject({
        displayName: "default",
        config: { homePath: "~/.claude" },
      });
    }).pipe(Effect.scoped),
  );
});
