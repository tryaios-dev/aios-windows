import { spawnSync } from "node:child_process";
import path from "node:path";
import type { DesktopPlatform } from "./types.js";

/** Windows 10 and 11: the platform AIOS ships for. */
export const windows: DesktopPlatform = {
  id: "windows",
  shipped: true,

  backendCommand({ packaged, resourcesPath, repoRoot }) {
    if (packaged) {
      return {
        cmd: path.join(resourcesPath, "backend", "backend.exe"),
        args: [],
        // Only what Windows and the data folder need; nothing else from the user's environment.
        env: { SystemRoot: process.env.SystemRoot ?? "", LOCALAPPDATA: process.env.LOCALAPPDATA ?? "" },
      };
    }
    return {
      cmd: path.join(repoRoot, ".venv", "Scripts", "python.exe"),
      args: ["-m", "aios_backend"],
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    };
  },

  // The venv's python.exe starts the real interpreter as a child, so killing the parent alone
  // would leave the backend running. taskkill /T stops the whole tree.
  stopProcessTree(child) {
    if (child.pid === undefined || child.exitCode !== null) return;
    const result = spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
    if (result.status !== 0) child.kill();
  },
};
