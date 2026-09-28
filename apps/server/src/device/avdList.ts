import type { DeviceHostId, DeviceSummary } from "@t3tools/contracts";

/**
 * Adds the stopped Android virtual devices from `emulator -list-avds` output to
 * the hub's device list. The hub only lists running emulators (by serial), so
 * an AVD whose name it already reports is running and is not added twice.
 * The emulator prints diagnostics such as `INFO | ...` lines alongside names
 * on some SDK versions; AVD names never contain spaces or a `|`.
 */
export function withStoppedAvds(
  devices: ReadonlyArray<DeviceSummary>,
  hostId: DeviceHostId,
  listAvdsStdout: string,
): DeviceSummary[] {
  const merged = [...devices];
  for (const name of listAvdsStdout.split(/\r?\n/).map((line) => line.trim())) {
    if (!name || /[\s|]/.test(name)) continue;
    if (merged.some((device) => device.platform === "android" && device.name === name)) continue;
    merged.push({
      hostId,
      id: name,
      name,
      platform: "android",
      version: "Android",
      booted: false,
      physical: false,
    });
  }
  return merged;
}
