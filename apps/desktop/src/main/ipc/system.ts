import { Health, SupportBundle, SystemInfo, SystemStatus } from "@aios/bridge-contract";
import { openExternalConfirmed } from "../links.js";
import { pickSaveTarget } from "./dialogs.js";
import type { Handler } from "./index.js";

/** File name the save dialog suggests: the time it was made, so bundles never overwrite each other. */
function bundleName(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `aios-support-bundle-${stamp}.zip`;
}

export const systemHandlers: Record<string, Handler> = {
  "system.health": async (b) => Health.parse(await b.client.request("GET", "/health")),
  "system.status": async (b) => SystemStatus.parse(await b.client.request("GET", "/system/status")),
  "system.info": async (b) => SystemInfo.parse(await b.client.request("GET", "/system/info")),
  /** The user picks where; the backend writes a zip of the log folder (logs only) there. */
  "system.supportBundle": async (b) => {
    const target = await pickSaveTarget("Save the support bundle", bundleName(), "zip");
    if (!target) return null;
    return SupportBundle.parse(await b.client.request("POST", "/system/support-bundle", { path: target }));
  },
  /** Never reaches the backend: main validates the link and asks the user before opening it. */
  "system.openLink": async (_b, url) => openExternalConfirmed(url),
};
