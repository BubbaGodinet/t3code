import * as Schema from "effect/Schema";

import { IsoDateTime, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ProviderDriverKind, ProviderInstanceId } from "./providerInstance.ts";

export const ProviderSetupInput = Schema.Struct({
  instanceId: ProviderInstanceId,
});
export type ProviderSetupInput = typeof ProviderSetupInput.Type;

const SetupOperationId = TrimmedNonEmptyString.check(Schema.isMaxLength(128));

export const ProviderAuthState = Schema.Struct({
  instanceId: ProviderInstanceId,
  phase: Schema.Literals([
    "idle",
    "starting",
    "waiting",
    "verifying",
    "succeeded",
    "failed",
    "cancelled",
  ]),
  flowId: Schema.NullOr(SetupOperationId),
  authorizationUrl: Schema.NullOr(Schema.String),
  expiresAt: Schema.NullOr(IsoDateTime),
  message: Schema.NullOr(Schema.String),
});
export type ProviderAuthState = typeof ProviderAuthState.Type;

export const ProviderAuthCompleteInput = Schema.Struct({
  instanceId: ProviderInstanceId,
  flowId: SetupOperationId,
  callbackUrl: TrimmedNonEmptyString.check(Schema.isMaxLength(16_384)),
});
export type ProviderAuthCompleteInput = typeof ProviderAuthCompleteInput.Type;

export const ProviderAuthCancelInput = Schema.Struct({
  instanceId: ProviderInstanceId,
  flowId: SetupOperationId,
});
export type ProviderAuthCancelInput = typeof ProviderAuthCancelInput.Type;

const ByteCount = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export const ProviderInstallState = Schema.Struct({
  driver: ProviderDriverKind,
  operationId: Schema.NullOr(SetupOperationId),
  phase: Schema.Literals([
    "idle",
    "downloading",
    "extracting",
    "verifying",
    "succeeded",
    "failed",
    "cancelled",
  ]),
  downloadedBytes: ByteCount,
  totalBytes: Schema.NullOr(ByteCount),
  version: Schema.NullOr(TrimmedNonEmptyString),
  installedVersion: Schema.NullOr(TrimmedNonEmptyString),
  canRemove: Schema.Boolean,
  message: Schema.NullOr(Schema.String),
});
export type ProviderInstallState = typeof ProviderInstallState.Type;

export const ProviderInstallCancelInput = Schema.Struct({
  instanceId: ProviderInstanceId,
  operationId: SetupOperationId,
});
export type ProviderInstallCancelInput = typeof ProviderInstallCancelInput.Type;

/** Drivers whose CLI login can create an additional account from the UI. */
export const ProviderAccountLoginDriver = Schema.Literals(["claudeAgent", "codex"]);
export type ProviderAccountLoginDriver = typeof ProviderAccountLoginDriver.Type;

export const ProviderAccountLoginStartInput = Schema.Struct({
  driver: ProviderAccountLoginDriver,
  label: TrimmedNonEmptyString.check(Schema.isMaxLength(64)),
});
export type ProviderAccountLoginStartInput = typeof ProviderAccountLoginStartInput.Type;

export const ProviderAccountLoginFlowInput = Schema.Struct({
  flowId: SetupOperationId,
});
export type ProviderAccountLoginFlowInput = typeof ProviderAccountLoginFlowInput.Type;

export const ProviderAccountLoginCodeInput = Schema.Struct({
  flowId: SetupOperationId,
  code: TrimmedNonEmptyString.check(Schema.isMaxLength(4_096)),
});
export type ProviderAccountLoginCodeInput = typeof ProviderAccountLoginCodeInput.Type;

/**
 * One sign-in of a new account into its own config directory. On success the
 * account is already registered as `instanceId` in `providerInstances`.
 */
export const ProviderAccountLoginState = Schema.Struct({
  flowId: SetupOperationId,
  driver: ProviderAccountLoginDriver,
  label: Schema.String,
  instanceId: ProviderInstanceId,
  /** Home-relative form, e.g. `~/.claude_doordash`. */
  configDir: Schema.String,
  phase: Schema.Literals(["starting", "waiting", "succeeded", "failed", "cancelled"]),
  loginUrl: Schema.NullOr(Schema.String),
  userCode: Schema.NullOr(Schema.String),
  message: Schema.NullOr(Schema.String),
});
export type ProviderAccountLoginState = typeof ProviderAccountLoginState.Type;

export class ProviderAccountLoginError extends Schema.TaggedError<ProviderAccountLoginError>()(
  "ProviderAccountLoginError",
  {
    detail: Schema.String,
  },
) {
  override get message(): string {
    return this.detail;
  }
}

/** Safe setup failure text. Never include OAuth codes, URLs, or native token data. */
export class ProviderSetupError extends Schema.TaggedError<ProviderSetupError>()(
  "ProviderSetupError",
  {
    instanceId: ProviderInstanceId,
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.detail;
  }
}
