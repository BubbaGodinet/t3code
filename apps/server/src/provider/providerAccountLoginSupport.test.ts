import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import {
  accountLoginTarget,
  createAccountConfigDir,
  loginFailureLine,
  parseLoginOutput,
} from "./providerAccountLoginSupport.ts";

describe("accountLoginTarget", () => {
  it("slugs the label into the instance id and a per-driver home directory", () => {
    expect(accountLoginTarget("claudeAgent", "DoorDash")).toEqual({
      instanceId: "claudeAgent_doordash",
      dirName: ".claude_doordash",
    });
    expect(accountLoginTarget("codex", "  Motley Fool! ")).toEqual({
      instanceId: "codex_motley_fool",
      dirName: ".codex_motley_fool",
    });
  });

  it("never produces a path segment that leaves the home directory", () => {
    expect(accountLoginTarget("claudeAgent", "../../etc")?.dirName).toBe(".claude_etc");
    expect(accountLoginTarget("codex", "a/b\\c")?.dirName).toBe(".codex_a_b_c");
  });

  it("rejects a label with no letters or numbers", () => {
    expect(accountLoginTarget("claudeAgent", " -- ")).toBeNull();
  });

  it("caps the slug so the instance id fits the 64-character limit", () => {
    const target = accountLoginTarget("claudeAgent", "x".repeat(200));
    expect(target?.instanceId.length).toBeLessThanOrEqual(64);
  });
});

it.layer(NodeServices.layer)("createAccountConfigDir", (it) => {
  it.effect("creates a fresh private directory", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const home = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-account-login-" });

      const directory = yield* createAccountConfigDir(home, ".claude_doordash");

      expect(directory).toBe((yield* Path.Path).join(home, ".claude_doordash"));
      const info = yield* fileSystem.stat(directory);
      expect(info.type).toBe("Directory");
      expect(info.mode & 0o077).toBe(0);
    }),
  );

  it.effect("refuses an existing directory and leaves its contents alone", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-account-login-" });
      const existing = path.join(home, ".codex_personal");
      yield* fileSystem.makeDirectory(existing);
      yield* fileSystem.writeFileString(path.join(existing, "auth.json"), "{}");

      const error = yield* createAccountConfigDir(home, ".codex_personal").pipe(Effect.flip);

      expect(error.detail).toContain("~/.codex_personal already exists");
      expect(yield* fileSystem.readDirectory(existing)).toEqual(["auth.json"]);
      expect(yield* fileSystem.readFileString(path.join(existing, "auth.json"))).toBe("{}");
    }),
  );
});

describe("parseLoginOutput", () => {
  it("reads Claude's link through its terminal hyperlink escape", () => {
    const url = "https://claude.ai/oauth/authorize?code=true&state=abc";
    const output = `Opening browser to sign in…\nIf the browser didn't open, visit: \u001b]8;;${url}\u0007${url}\u001b]8;;\u0007\nPaste code here if prompted > `;
    expect(parseLoginOutput(output)).toEqual({ loginUrl: url, userCode: null });
  });

  it("waits for the end of a line before taking a link", () => {
    expect(parseLoginOutput("visit: https://auth.openai.com/oauth/auth").loginUrl).toBeNull();
  });

  it("reads a device code", () => {
    const output =
      "1. Open this link in your browser\n   https://auth.openai.com/codex/device\n2. Enter this one-time code\n   ABCD-EFGH2\n";
    expect(parseLoginOutput(output)).toEqual({
      loginUrl: "https://auth.openai.com/codex/device",
      userCode: "ABCD-EFGH2",
    });
  });
});

describe("loginFailureLine", () => {
  it("drops links and redacts token-like strings", () => {
    expect(
      loginFailureLine(
        "visit: https://x.test/a\nError: invalid grant fake_0123456789abcdefghijklmnopqrstuvwxyz\n",
      ),
    ).toBe("Error: invalid grant [redacted]");
  });
});
