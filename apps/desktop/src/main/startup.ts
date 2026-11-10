import type { BackendHandle } from "./backend/spawn.js";
import { log } from "./logging.js";

/** What the start-up flow needs from Electron; injected so it can be tested without it. */
export interface StartupDeps {
  /** Show the small "Starting AIOS…" window (or keep the one already open). */
  showStarting(): void;
  startBackend(): Promise<BackendHandle>;
  stopBackend(): Promise<void>;
  /** Register IPC, open the main window and close the start-up window. */
  openApp(backend: BackendHandle): Promise<void>;
  /** Show "AIOS could not start" with Retry and Quit. */
  askRetryOrQuit(errorCode: string): Promise<"retry" | "quit">;
  quit(): void;
  /** True once the user has closed AIOS; a late start-up error then shows nothing. */
  quitting(): boolean;
}

export function errorCode(err: unknown): string {
  const message = err instanceof Error ? err.message : "";
  return /^[a-z0-9_]+$/.test(message) ? message : "backend_start_failed";
}

/**
 * Start AIOS so that a window is always on screen: the start-up window first, then the backend.
 * A failed start shows Retry/Quit instead of leaving the app running with no window.
 * Returns the backend, or null when the user quit.
 */
export async function runStartup(d: StartupDeps): Promise<BackendHandle | null> {
  for (;;) {
    d.showStarting();
    try {
      const backend = await d.startBackend();
      await d.openApp(backend);
      return backend;
    } catch (err) {
      await d.stopBackend();
      if (d.quitting()) return null;
      const code = errorCode(err);
      log("app.start_failed", { errorCode: code });
      if ((await d.askRetryOrQuit(code)) === "quit") {
        d.quit();
        return null;
      }
    }
  }
}

/** A second launch of AIOS: bring the open window forward, or open one if none exists. */
export function onSecondInstance(
  windows: { isMinimized(): boolean; restore(): void; show(): void; focus(): void }[],
  reopen: () => void,
): void {
  const win = windows[0];
  if (!win) return reopen();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}
