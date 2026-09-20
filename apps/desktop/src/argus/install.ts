import * as Electron from "electron";

import { attachArgusWindowManager } from "./window-manager.ts";

export function installArgusDesktop(
  main: Electron.BrowserWindow,
  t3Origin?: string,
  preloadPath?: string,
) {
  return attachArgusWindowManager(main, Electron.app.getPath("userData"), t3Origin, preloadPath);
}
