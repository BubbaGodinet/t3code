// @effect-diagnostics nodeBuiltinImport:off
import * as NodeOS from "node:os";

import {
  defaultInstanceIdForDriver,
  ProviderAccountLoginError,
  type ProviderAccountLoginCodeInput,
  type ProviderAccountLoginDriver,
  type ProviderAccountLoginFlowInput,
  type ProviderAccountLoginStartInput,
  type ProviderAccountLoginState,
  ProviderDriverKind,
  type ProviderInstanceConfig,
  type ProviderInstanceId,
} from "@t3tools/contracts";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { expandHomePath } from "../pathExpansion.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { deriveProviderInstanceConfigMap } from "./Layers/ProviderInstanceRegistryHydration.ts";
import { isCommandMissingCause } from "./providerSnapshot.ts";
import {
  accountLoginTarget,
  createAccountConfigDir,
  loginFailureLine,
  parseLoginOutput,
} from "./providerAccountLoginSupport.ts";

const LOGIN_TIMEOUT = "10 minutes";
const OUTPUT_MAX_CHARS = 64 * 1024;

const DRIVERS: Record<
  ProviderAccountLoginDriver,
  {
    readonly name: string;
    readonly binary: string;
    readonly args: ReadonlyArray<string>;
    readonly envVar: string;
  }
> = {
  claudeAgent: {
    name: "Claude",
    binary: "claude",
    args: ["auth", "login"],
    envVar: "CLAUDE_CONFIG_DIR",
  },
  codex: { name: "Codex", binary: "codex", args: ["login"], envVar: "CODEX_HOME" },
};

const isLoginError = Schema.is(ProviderAccountLoginError);
const hasBinaryPath = Schema.is(Schema.Struct({ binaryPath: Schema.String }));

export interface ProviderAccountLoginShape {
  readonly start: (
    input: ProviderAccountLoginStartInput,
  ) => Effect.Effect<ProviderAccountLoginState, ProviderAccountLoginError>;
  readonly submitCode: (
    input: ProviderAccountLoginCodeInput,
  ) => Effect.Effect<ProviderAccountLoginState, ProviderAccountLoginError>;
  readonly cancel: (
    input: ProviderAccountLoginFlowInput,
  ) => Effect.Effect<ProviderAccountLoginState, ProviderAccountLoginError>;
  readonly subscribe: (
    input: ProviderAccountLoginFlowInput,
  ) => Stream.Stream<ProviderAccountLoginState, ProviderAccountLoginError>;
}

interface LoginFlow {
  readonly state: SubscriptionRef.SubscriptionRef<ProviderAccountLoginState>;
  readonly stdin: Queue.Queue<string>;
  fiber: Fiber.Fiber<void> | undefined;
}

const isActive = (state: ProviderAccountLoginState) =>
  state.phase === "starting" || state.phase === "waiting";

/**
 * Signs an extra Claude or Codex account into its own config directory by
 * running the CLI's own login in the background, then registers it as a
 * provider instance. Server-lifetime, so a closed dialog or dropped socket
 * does not abandon a half-finished login.
 */
export const makeProviderAccountLogin = Effect.fn("makeProviderAccountLogin")(function* (
  homeDir: string = NodeOS.homedir(),
) {
  const settings = yield* ServerSettingsService;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const scope = yield* Scope.Scope;
  const flows = new Map<string, LoginFlow>();

  const fail = (detail: string) => new ProviderAccountLoginError({ detail });
  const readSettings = settings.getSettings.pipe(
    Effect.mapError(() => fail("Could not read provider settings.")),
  );

  const register = Effect.fn("ProviderAccountLogin.register")(function* (input: {
    readonly instanceId: ProviderInstanceId;
    readonly instance: ProviderInstanceConfig;
  }) {
    const current = yield* readSettings;
    if (Object.hasOwn(deriveProviderInstanceConfigMap(current), input.instanceId)) {
      return yield* fail(
        `Signed in, but an account named ${input.instanceId} was added meanwhile. Add the folder in Settings › Providers.`,
      );
    }
    yield* settings
      .updateSettings({
        providerInstances: { ...current.providerInstances, [input.instanceId]: input.instance },
      })
      .pipe(
        Effect.mapError(() =>
          fail("Signed in, but the account could not be saved. Add it in Settings › Providers."),
        ),
      );
  });

  const runLogin = (
    flow: LoginFlow,
    input: {
      readonly driver: ProviderAccountLoginDriver;
      readonly command: string;
      readonly configDir: string;
      readonly instanceId: ProviderInstanceId;
      readonly instance: ProviderInstanceConfig;
    },
  ) => {
    const driver = DRIVERS[input.driver];
    let signedIn = false;
    return Effect.gen(function* () {
      const env = { [driver.envVar]: input.configDir };
      const spawnCommand = yield* resolveSpawnCommand(input.command, driver.args, {
        env,
        extendEnv: true,
      });
      const child = yield* spawner
        .spawn(
          ChildProcess.make(spawnCommand.command, spawnCommand.args, {
            env,
            extendEnv: true,
            shell: spawnCommand.shell,
            forceKillAfter: "2 seconds",
          }),
        )
        .pipe(
          Effect.mapError((cause) =>
            fail(
              isCommandMissingCause(cause)
                ? `The ${driver.name} CLI (${input.command}) is not installed on this machine. Install it, or set its binary path in Settings › Providers.`
                : `Could not start ${driver.name} sign-in.`,
            ),
          ),
        );
      yield* Stream.fromQueue(flow.stdin).pipe(
        Stream.map((line) => `${line}\n`),
        Stream.encodeText,
        Stream.run(child.stdin),
        Effect.ignore,
        Effect.forkScoped,
      );
      let output = "";
      const reader = yield* child.all.pipe(
        Stream.decodeText(),
        Stream.runForEach((chunk) => {
          output = (output + chunk).slice(-OUTPUT_MAX_CHARS);
          const parsed = parseLoginOutput(output);
          return SubscriptionRef.update(flow.state, (state) => {
            const loginUrl = state.loginUrl ?? parsed.loginUrl;
            const userCode = state.userCode ?? parsed.userCode;
            if (loginUrl === state.loginUrl && userCode === state.userCode) return state;
            return {
              ...state,
              phase: "waiting" as const,
              loginUrl,
              userCode,
              message: "Waiting for you to finish signing in.",
            };
          });
        }),
        Effect.ignore,
        Effect.forkScoped,
      );
      const exitCode = yield* child.exitCode.pipe(
        Effect.mapError(() => fail(`${driver.name} sign-in stopped unexpectedly.`)),
      );
      yield* Fiber.join(reader);
      if (Number(exitCode) !== 0) {
        return yield* fail(
          loginFailureLine(output) ??
            `${driver.name} sign-in did not finish (exit code ${Number(exitCode)}).`,
        );
      }
      signedIn = true;
      yield* register(input);
    }).pipe(
      Effect.scoped,
      Effect.timeoutOrElse({
        duration: LOGIN_TIMEOUT,
        orElse: () => Effect.fail(fail("Sign-in timed out. Start again.")),
      }),
      Effect.onExit((exit) =>
        Effect.gen(function* () {
          // The directory was created for this login; keep it only once it holds one.
          if (!signedIn) {
            yield* fileSystem.remove(input.configDir, { recursive: true }).pipe(Effect.ignore);
          }
          yield* Queue.shutdown(flow.stdin);
          yield* SubscriptionRef.update(flow.state, (state) =>
            Exit.isSuccess(exit)
              ? {
                  ...state,
                  phase: "succeeded" as const,
                  loginUrl: null,
                  userCode: null,
                  message: `Signed in. ${state.label} is now one of your ${driver.name} accounts.`,
                }
              : {
                  ...state,
                  phase: Cause.hasInterruptsOnly(exit.cause)
                    ? ("cancelled" as const)
                    : ("failed" as const),
                  loginUrl: null,
                  userCode: null,
                  message: Cause.hasInterruptsOnly(exit.cause)
                    ? "Sign-in cancelled."
                    : Option.match(Cause.findErrorOption(exit.cause), {
                        onNone: () => `${driver.name} sign-in failed.`,
                        onSome: (error) =>
                          isLoginError(error) ? error.detail : `${driver.name} sign-in failed.`,
                      }),
                },
          );
        }),
      ),
      Effect.ignore,
    );
  };

  const requireFlow = (flowId: string): Effect.Effect<LoginFlow, ProviderAccountLoginError> => {
    const flow = flows.get(flowId);
    return flow
      ? Effect.succeed(flow)
      : Effect.fail(fail("This sign-in is no longer running. Start again."));
  };

  const start = Effect.fn("ProviderAccountLogin.start")(function* (
    input: ProviderAccountLoginStartInput,
  ) {
    const driver = DRIVERS[input.driver];
    const target = accountLoginTarget(input.driver, input.label);
    if (target === null) {
      return yield* fail("Use at least one letter or number in the label.");
    }
    const instances = deriveProviderInstanceConfigMap(yield* readSettings);
    if (Object.hasOwn(instances, target.instanceId)) {
      return yield* fail(
        `An account named ${target.instanceId} already exists. Use another label.`,
      );
    }
    for (const [flowId, flow] of flows) {
      const state = yield* SubscriptionRef.get(flow.state);
      if (!isActive(state)) {
        flows.delete(flowId);
      } else if (state.instanceId === target.instanceId) {
        return yield* fail(`${input.label} is already signing in.`);
      }
    }
    // A Claude or Codex default with a custom binary is the one this machine can run.
    const defaultConfig =
      instances[defaultInstanceIdForDriver(ProviderDriverKind.make(input.driver))]?.config;
    const customBinaryPath = hasBinaryPath(defaultConfig) ? defaultConfig.binaryPath.trim() : "";
    const configDir = yield* createAccountConfigDir(homeDir, target.dirName).pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
    );
    const flowId = yield* crypto.randomUUIDv4.pipe(
      Effect.tapError(() => fileSystem.remove(configDir, { recursive: true }).pipe(Effect.ignore)),
      Effect.mapError(() => fail("Could not start sign-in. Try again.")),
    );
    const flow: LoginFlow = {
      state: yield* SubscriptionRef.make<ProviderAccountLoginState>({
        flowId,
        driver: input.driver,
        label: input.label,
        instanceId: target.instanceId,
        configDir: `~/${target.dirName}`,
        phase: "starting",
        loginUrl: null,
        userCode: null,
        message: `Starting ${driver.name} sign-in.`,
      }),
      stdin: yield* Queue.unbounded<string>(),
      fiber: undefined,
    };
    flows.set(flowId, flow);
    flow.fiber = yield* runLogin(flow, {
      driver: input.driver,
      command: expandHomePath(customBinaryPath || driver.binary),
      configDir,
      instanceId: target.instanceId,
      instance: {
        driver: ProviderDriverKind.make(input.driver),
        enabled: true,
        displayName: input.label,
        config: {
          homePath: `~/${target.dirName}`,
          ...(customBinaryPath ? { binaryPath: customBinaryPath } : {}),
        },
      },
    }).pipe(Effect.forkIn(scope));
    return yield* SubscriptionRef.get(flow.state);
  });

  const submitCode = Effect.fn("ProviderAccountLogin.submitCode")(function* (
    input: ProviderAccountLoginCodeInput,
  ) {
    const flow = yield* requireFlow(input.flowId);
    const state = yield* SubscriptionRef.get(flow.state);
    if (!isActive(state)) {
      return yield* fail("This sign-in already finished.");
    }
    yield* Queue.offer(flow.stdin, input.code);
    return yield* SubscriptionRef.updateAndGet(flow.state, (current) => ({
      ...current,
      message: "Code sent. Finishing sign-in.",
    }));
  });

  const cancel = Effect.fn("ProviderAccountLogin.cancel")(function* (
    input: ProviderAccountLoginFlowInput,
  ) {
    const flow = yield* requireFlow(input.flowId);
    if (flow.fiber) yield* Fiber.interrupt(flow.fiber);
    return yield* SubscriptionRef.get(flow.state);
  });

  const subscribe = (input: ProviderAccountLoginFlowInput) =>
    Stream.unwrap(
      requireFlow(input.flowId).pipe(Effect.map((flow) => SubscriptionRef.changes(flow.state))),
    );

  yield* Effect.addFinalizer(() =>
    Effect.forEach(
      flows.values(),
      (flow) => (flow.fiber ? Fiber.interrupt(flow.fiber) : Effect.void),
      { discard: true },
    ),
  );

  return { start, submitCode, cancel, subscribe } satisfies ProviderAccountLoginShape;
});

export class ProviderAccountLogin extends Context.Service<
  ProviderAccountLogin,
  ProviderAccountLoginShape
>()("t3/provider/ProviderAccountLogin") {
  static readonly layer = Layer.effect(ProviderAccountLogin, makeProviderAccountLogin());
}
