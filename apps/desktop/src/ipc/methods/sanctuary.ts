import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

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
