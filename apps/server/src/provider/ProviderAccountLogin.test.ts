import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  DEFAULT_SERVER_SETTINGS,
  type ProviderAccountLoginState,
  type ServerSettingsPatch,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";

import { ServerSettingsService } from "../serverSettings.ts";
import { makeProviderAccountLogin } from "./ProviderAccountLogin.ts";

const FAKE_CLAUDE = `#!/bin/sh
echo "Opening browser to sign in..."
echo "If the browser didn't open, visit: https://claude.ai/oauth/authorize?state=test"
printf "Paste code here if prompted > "
read code
if [ "$code" = "good-code" ]; then
  echo '{}' > "$CLAUDE_CONFIG_DIR/.credentials.json"
  echo "Login successful."
  exit 0
fi
echo "Login failed: invalid code"
exit 1
`;

const setup = Effect.fn("ProviderAccountLogin.test.setup")(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const home = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-account-login-" });
  const binaryPath = path.join(home, "fake-claude");
  yield* fileSystem.writeFileString(binaryPath, FAKE_CLAUDE);
  yield* fileSystem.chmod(binaryPath, 0o755);
  const saved: ServerSettingsPatch[] = [];
  const settings = Layer.mock(ServerSettingsService)({
    getSettings: Effect.succeed({
      ...DEFAULT_SERVER_SETTINGS,
      providers: {
        ...DEFAULT_SERVER_SETTINGS.providers,
        claudeAgent: { ...DEFAULT_SERVER_SETTINGS.providers.claudeAgent, binaryPath },
      },
    }),
    updateSettings: (patch) =>
      Effect.sync(() => {
        saved.push(patch);
        return DEFAULT_SERVER_SETTINGS;
      }),
  });
  const login = yield* makeProviderAccountLogin(home).pipe(Effect.provide(settings));
  const configDir = path.join(home, ".claude_doordash");
  return { login, saved, binaryPath, configDir, fileSystem };
});

const waitFor = (
  states: Stream.Stream<ProviderAccountLoginState, unknown>,
  done: (state: ProviderAccountLoginState) => boolean,
) => states.pipe(Stream.filter(done), Stream.runHead, Effect.map(Option.getOrThrow));

const isFinished = (state: ProviderAccountLoginState) =>
  state.phase === "succeeded" || state.phase === "failed" || state.phase === "cancelled";

it.layer(NodeServices.layer)("ProviderAccountLogin", (it) => {
  describe("claude", () => {
    it.effect("shows the link, forwards the pasted code, and registers the account", () =>
      Effect.gen(function* () {
        const { login, saved, binaryPath, configDir, fileSystem } = yield* setup();

        const started = yield* login.start({ driver: "claudeAgent", label: "DoorDash" });
        expect(started).toMatchObject({
          instanceId: "claudeAgent_doordash",
          configDir: "~/.claude_doordash",
        });
        const waiting = yield* waitFor(
          login.subscribe({ flowId: started.flowId }),
          (state) => state.loginUrl !== null,
        );
        expect(waiting.phase).toBe("waiting");
        expect(waiting.loginUrl).toBe("https://claude.ai/oauth/authorize?state=test");

        yield* login.submitCode({ flowId: started.flowId, code: "good-code" });
        const finished = yield* waitFor(login.subscribe({ flowId: started.flowId }), isFinished);

        expect(finished.phase).toBe("succeeded");
        expect(yield* fileSystem.exists(`${configDir}/.credentials.json`)).toBe(true);
        expect(saved).toEqual([
          {
            providerInstances: {
              claudeAgent_doordash: {
                driver: "claudeAgent",
                enabled: true,
                displayName: "DoorDash",
                config: { homePath: "~/.claude_doordash", binaryPath },
              },
            },
          },
        ]);
      }).pipe(Effect.scoped),
    );

    it.effect("reports a rejected code and removes the directory it created", () =>
      Effect.gen(function* () {
        const { login, saved, configDir, fileSystem } = yield* setup();

        const started = yield* login.start({ driver: "claudeAgent", label: "DoorDash" });
        yield* waitFor(login.subscribe({ flowId: started.flowId }), (s) => s.loginUrl !== null);
        yield* login.submitCode({ flowId: started.flowId, code: "wrong" });
        const finished = yield* waitFor(login.subscribe({ flowId: started.flowId }), isFinished);

        expect(finished).toMatchObject({
          phase: "failed",
          message: "Login failed: invalid code",
        });
        expect(yield* fileSystem.exists(configDir)).toBe(false);
        expect(saved).toEqual([]);
      }).pipe(Effect.scoped),
    );

    it.effect("cancels a waiting sign-in", () =>
      Effect.gen(function* () {
        const { login, saved, configDir, fileSystem } = yield* setup();

        const started = yield* login.start({ driver: "claudeAgent", label: "DoorDash" });
        yield* waitFor(login.subscribe({ flowId: started.flowId }), (s) => s.loginUrl !== null);
        yield* login.cancel({ flowId: started.flowId });
        const finished = yield* waitFor(login.subscribe({ flowId: started.flowId }), isFinished);

        expect(finished.phase).toBe("cancelled");
        expect(yield* fileSystem.exists(configDir)).toBe(false);
        expect(saved).toEqual([]);
      }).pipe(Effect.scoped),
    );

    it.effect("refuses to sign in over an existing config directory", () =>
      Effect.gen(function* () {
        const { login, configDir, fileSystem } = yield* setup();
        yield* fileSystem.makeDirectory(configDir);
        yield* fileSystem.writeFileString(`${configDir}/.credentials.json`, "keep");

        const error = yield* login
          .start({ driver: "claudeAgent", label: "DoorDash" })
          .pipe(Effect.flip);

        expect(error.detail).toContain("~/.claude_doordash already exists");
        expect(yield* fileSystem.readFileString(`${configDir}/.credentials.json`)).toBe("keep");
      }).pipe(Effect.scoped),
    );
  });
});
