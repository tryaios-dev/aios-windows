// electron-updater is CommonJS; named ESM imports fail at runtime, so take the default export.
import updater from "electron-updater";
import { log } from "./logging.js";

const { autoUpdater } = updater;

/** Check at start and at most once a day; signed updates only; user can switch off (M-17).
 * A feed that cannot be reached is logged and ignored: the app keeps working offline. */
export function initUpdater(enabled = true): void {
  if (!enabled) return;
  autoUpdater.autoDownload = true;
  autoUpdater.on("error", () => log("updater.error", { component: "updater" }));
  const check = () =>
    autoUpdater.checkForUpdatesAndNotify().catch(() => log("updater.check_failed", { component: "updater" }));
  void check();
  setInterval(() => void check(), 24 * 60 * 60 * 1000);
}
