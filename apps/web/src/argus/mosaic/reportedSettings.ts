import { useAtomValue } from "@effect/atom-react";
import { resolveServerConfigValue } from "@t3tools/client-runtime/state/server";
import type { EnvironmentId, ServerSettings } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

import { serverEnvironment } from "../../state/server";
import { environmentSession } from "../../state/session";

const unreportedAtom = Atom.make<ServerSettings | undefined>(undefined);

const reportedSettingsAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make((get): ServerSettings | undefined => {
    const projection = Option.getOrNull(
      AsyncResult.value(get(serverEnvironment.configProjection({ environmentId, input: {} }))),
    );
    return resolveServerConfigValue(
      projection?.source === "live" ? projection : null,
      get(environmentSession.initialConfigValueAtom(environmentId)),
    )?.settings;
  }).pipe(Atom.withLabel(`argus-mosaic:reported-settings:${environmentId}`)),
);

/**
 * The server's settings as it reported them on this connection, or
 * `undefined` until it has. Unlike `configValueAtom` this never yields the
 * config cached from an earlier session: the mosaic writes whole documents
 * back, so loading a stale cached copy would save it over newer server state.
 */
export function useReportedServerSettings(
  environmentId: EnvironmentId | null,
): ServerSettings | undefined {
  return useAtomValue(
    environmentId === null ? unreportedAtom : reportedSettingsAtom(environmentId),
  );
}
