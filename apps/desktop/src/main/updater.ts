// electron-updater is CommonJS; named ESM imports fail at runtime, so take the default export.
import { app } from "electron";
import updater from "electron-updater";
import type { BackendHandle } from "./backend/spawn.js";
import { log } from "./logging.js";

/** Created on first use: constructing it reads the app version from Electron. */
const autoUpdater = () => updater.autoUpdater;
const DAY = 24 * 60 * 60 * 1000;

interface Found {
  version: string;
  size_bytes: number;
}

/** Ask the signed update feed. Only the installed app has a feed; dev builds find nothing. */
async function askFeed(): Promise<Found | null> {
  if (!app.isPackaged) return null;
  const result = await autoUpdater().checkForUpdates();
  const info = result?.updateInfo;
  if (!info || info.version === app.getVersion()) return null;
  const size = info.files.reduce((sum, f) => sum + (f.size ?? 0), 0);
  return { version: info.version, size_bytes: size };
}

/** Check now and record the result in the backend (Settings > General shows it). */
export async function checkForUpdate(backend: BackendHandle): Promise<unknown> {
  let found: Found | null = null;
  try {
    found = await askFeed();
  } catch {
    // Offline or feed unreachable: keep working and record that nothing was found.
    log("updater.check_failed", { component: "updater" });
  }
  return backend.client.request("POST", "/settings/update-check", { update_available: found });
}

/**
 * Check at start and at most once a day, signed updates only, and only while the update check
 * is switched on in Settings (M-17). A feed that cannot be reached is logged and ignored.
 */
export function initUpdater(backend: BackendHandle): void {
  autoUpdater().autoDownload = app.isPackaged;
  autoUpdater().on("error", () => log("updater.error", { component: "updater" }));
  const tick = async () => {
    try {
      const settings = await backend.client.request<{ update_check: boolean }>("GET", "/settings");
      if (settings.update_check) await checkForUpdate(backend);
    } catch {
      log("updater.check_failed", { component: "updater" });
    }
  };
  void tick();
  setInterval(() => void tick(), DAY);
}
