import * as ChildProcess from "node:child_process";
import * as Fs from "node:fs";
import * as Http from "node:http";
import * as Path from "node:path";

export const DEFAULT_ARGUS_ORIGIN = process.env.ARGUS_ORIGIN ?? "http://localhost:3100";

let spawned: ChildProcess.ChildProcess | null = null;

export async function ensureArgusHost(origin = DEFAULT_ARGUS_ORIGIN): Promise<string> {
  if (await ping(`${origin.replace(/\/$/, "")}/api/health`)) return origin;
  const root = resolveArgusRoot();
  if (!root) return origin;
  spawned?.unref();
  spawned = ChildProcess.spawn("npm", ["run", "dev"], {
    cwd: root,
    env: process.env,
    stdio: "ignore",
    detached: false,
  });
  spawned.unref();
  await waitFor(`${origin.replace(/\/$/, "")}/api/health`, 45_000);
  return origin;
}

export function resolveArgusRoot(): string | null {
  if (process.env.ARGUS_ROOT && Fs.existsSync(Path.join(process.env.ARGUS_ROOT, "package.json"))) {
    return process.env.ARGUS_ROOT;
  }
  const candidates = [
    Path.resolve(process.cwd(), "apps/argus"),
    Path.resolve(process.cwd(), "../argus"),
    Path.resolve(__dirname, "../../../../../argus"),
    Path.resolve(__dirname, "../../../../../../argus"),
    Path.resolve(__dirname, "../../../../../../../apps/argus"),
  ];
  return candidates.find((dir) => Fs.existsSync(Path.join(dir, "package.json"))) ?? null;
}

function ping(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const request = Http.get(url, (response) => {
      response.resume();
      resolve((response.statusCode ?? 500) < 500);
    });
    request.on("error", () => resolve(false));
    request.setTimeout(1500, () => {
      request.destroy();
      resolve(false);
    });
  });
}

async function waitFor(url: string, timeoutMs: number): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await ping(url)) return;
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
}
