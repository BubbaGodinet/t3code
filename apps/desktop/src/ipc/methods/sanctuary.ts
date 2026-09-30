import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Electron from "electron";

import * as DesktopEnvironment from "../../app/DesktopEnvironment.ts";
import * as Sanctuary from "../../sanctuary/SanctuaryDesktop.ts";
import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

export const loadSanctuary = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.SANCTUARY_LOAD_CHANNEL,
  payload: Schema.Void,
  result: Schema.Unknown,
  handler: () => Sanctuary.loadSanctuaryDocument,
});

export const saveSanctuary = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.SANCTUARY_SAVE_CHANNEL,
  payload: Schema.Unknown,
  result: Schema.Boolean,
  handler: Sanctuary.saveSanctuaryDocument,
});

export const getSanctuaryCapabilities = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.SANCTUARY_CAPABILITIES_CHANNEL,
  payload: Schema.Void,
  result: Schema.Unknown,
  handler: Effect.fn("desktop.ipc.sanctuary.capabilities")(function* () {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    return yield* Sanctuary.sanctuaryCapabilities(environment.platform);
  }),
});

export const startSanctuaryDictation = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.SANCTUARY_DICTATION_CHANNEL,
  payload: Schema.Void,
  result: Schema.Boolean,
  handler: Effect.fn("desktop.ipc.sanctuary.dictation")(function* () {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    return Sanctuary.startSystemDictation(environment.platform);
  }),
});

export const connectSanctuarySimplefin = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.SANCTUARY_SIMPLEFIN_CONNECT_CHANNEL,
  payload: Schema.String,
  result: Schema.Unknown,
  handler: Sanctuary.connectSimplefin,
});

export const disconnectSanctuarySimplefin = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.SANCTUARY_SIMPLEFIN_DISCONNECT_CHANNEL,
  payload: Schema.Void,
  result: Schema.Void,
  handler: () => Sanctuary.disconnectSimplefin,
});

export const fetchSanctuarySimplefinAccounts = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.SANCTUARY_SIMPLEFIN_ACCOUNTS_CHANNEL,
  payload: Schema.Void,
  result: Schema.Unknown,
  handler: () => Sanctuary.fetchSimplefinAccounts,
});

export const runSanctuaryAi = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.SANCTUARY_AI_CHANNEL,
  payload: Schema.Struct({ task: Schema.Literals(["food", "ramble"]), text: Schema.String }),
  result: Schema.Unknown,
  handler: ({ task, text }) => Sanctuary.runSanctuaryAi(task, text),
});

/** `capturePage` never settles when the compositor is wedged; the transition then falls back. */
const CAPTURE_WINDOW_TIMEOUT = "1 second";

/**
 * A JPEG of the calling window's page, for the Command ↔ Sanctuary shader
 * transitions to distort. Null when it cannot be captured.
 */
export const captureSanctuaryWindow = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.SANCTUARY_CAPTURE_WINDOW_CHANNEL,
  payload: Schema.Void,
  result: Schema.Unknown,
  handler: (_input, event) => {
    const contents = event ? Electron.webContents.fromId(event.sender.id) : undefined;
    if (!contents || contents.isDestroyed()) return Effect.succeed(null);
    return Effect.tryPromise((_signal) => contents.capturePage()).pipe(
      Effect.map((image) => (image.isEmpty() ? null : image.toJPEG(90))),
      Effect.timeoutOption(CAPTURE_WINDOW_TIMEOUT),
      Effect.map(Option.getOrNull),
      Effect.orElseSucceed(() => null),
    );
  },
});
