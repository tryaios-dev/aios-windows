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

/** The settings fields the schedule needs (GET /settings). */
export interface CheckSettings {
  update_check: boolean;
  last_update_check: string | null;
}

/**
 * At start and at most once a day (M-18): the last check time is kept by the backend, so twenty
 * restarts in a day still give one check. Never while the switch is off.
 */
export function checkIsDue(settings: CheckSettings, now = Date.now()): boolean {
  if (!settings.update_check) return false;
  if (!settings.last_update_check) return true;
  const last = Date.parse(settings.last_update_check);
  return Number.isNaN(last) || now - last >= DAY;
}

/** Strictly newer by major.minor.patch; anything unreadable counts as not newer. */
export function isNewer(candidate: string, current: string): boolean {
  const parse = (v: string) => (/^\d+\.\d+\.\d+$/.test(v) ? v.split(".").map(Number) : null);
  const a = parse(candidate);
  const b = parse(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i]! !== b[i]!) return a[i]! > b[i]!;
  return false;
}

interface UpdaterOptions {
  autoDownload: boolean;
  allowDowngrade: boolean;
  allowPrerelease: boolean;
}

/** Signed feed only (latest.yml and the installer's Authenticode signature are checked by
 * electron-updater against publisherName); downgrades and pre-releases are never installed. */
export function configureUpdater(target: UpdaterOptions, packaged: boolean): void {
  target.autoDownload = packaged;
  target.allowDowngrade = false;
  target.allowPrerelease = false;
}

/** Ask the signed update feed. Only the installed app has a feed; dev builds find nothing. */
async function askFeed(): Promise<Found | null> {
  if (!app.isPackaged) return null;
  const result = await autoUpdater().checkForUpdates();
  const info = result?.updateInfo;
  if (!info || !isNewer(info.version, app.getVersion())) return null; // no downgrade (M-18)
  const size = info.files.reduce((sum, f) => sum + (f.size ?? 0), 0);
  return { version: info.version, size_bytes: size };
}

/** Check now and record the result in the backend (Settings > General shows it).
 * `manual`: the user pressed "Check now", which is recorded even while automatic checks are off. */
export async function checkForUpdate(backend: BackendHandle, manual = false): Promise<unknown> {
  let found: Found | null = null;
  try {
    found = await askFeed();
  } catch {
    // Offline or feed unreachable: keep working and record that nothing was found.
    log("updater.check_failed", { component: "updater" });
  }
  return backend.client.request("POST", "/settings/update-check", { update_available: found, manual });
}

/**
 * Check at start and at most once a day, signed updates only, and only while the update check
 * is switched on in Settings (M-17). A feed that cannot be reached is logged and ignored.
 */
export function initUpdater(backend: BackendHandle): void {
  configureUpdater(autoUpdater(), app.isPackaged);
  autoUpdater().on("error", () => log("updater.error", { component: "updater" }));
  const tick = async () => {
    try {
      const settings = await backend.client.request<CheckSettings>("GET", "/settings");
      if (checkIsDue(settings)) await checkForUpdate(backend);
    } catch {
      log("updater.check_failed", { component: "updater" });
    }
  };
  void tick();
  setInterval(() => void tick(), 60 * 60 * 1000); // look hourly; checkIsDue allows one a day
}
