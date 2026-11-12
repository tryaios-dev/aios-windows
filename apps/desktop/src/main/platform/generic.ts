import path from "node:path";
import type { DesktopPlatform } from "./types.js";

/**
 * Development fallback for an OS AIOS does not ship for (a developer's Mac or Linux machine):
 * `pnpm dev:desktop` works there, the installed app does not. A real port replaces it.
 */
export const generic: DesktopPlatform = {
  id: "generic",
  shipped: false,

  backendCommand({ repoRoot }) {
    return {
      cmd: path.join(repoRoot, ".venv", "bin", "python"),
      args: ["-m", "aios_backend"],
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    };
  },

  logsDir() {
    return null; // development only: logs go to the terminal
  },

  stopProcessTree(child) {
    if (child.exitCode === null) child.kill();
  },
};
