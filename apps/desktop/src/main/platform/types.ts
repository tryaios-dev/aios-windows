import type { ChildProcess } from "node:child_process";

/** How main starts the backend: program, arguments and the (minimal) environment it gets. */
export interface BackendCommand {
  cmd: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

export interface BackendLocation {
  /** True in the installed app, false under `pnpm dev:desktop`. */
  packaged: boolean;
  /** Electron's `process.resourcesPath` (installed app). */
  resourcesPath: string;
  /** The repository root (development). */
  repoRoot: string;
}

/**
 * Everything in Electron main that depends on the operating system. AIOS ships for Windows only;
 * another OS is added by writing one more implementation next to `windows.ts` (docs/platforms.md).
 */
export interface DesktopPlatform {
  /** Same ids as the Python platform layer: "windows", later e.g. "macos", "linux". */
  readonly id: string;
  /** True only for an OS AIOS ships for. The installed app refuses to start on any other. */
  readonly shipped: boolean;
  backendCommand(where: BackendLocation): BackendCommand;
  /** Stop the backend and every process it started. */
  stopProcessTree(child: ChildProcess): void;
}
