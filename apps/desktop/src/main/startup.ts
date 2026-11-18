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

/** The backend's exit code when chats.db was written by a newer AIOS (C-04 rollback). */
export const NEWER_DATA_CODE = "backend_exit_4";

/** The "could not start" dialog text for an error code. Retrying never helps with newer data. */
export function startFailureText(code: string): { detail: string; canRetry: boolean } {
  if (code === NEWER_DATA_CODE) {
    return {
      detail:
        "Your data was last opened by a newer version of AIOS, so this version cannot open it. " +
        "Install the newer version again. Your data has not been changed.\n\nCode: " +
        code,
      canRetry: false,
    };
  }
  return {
    detail: `The background service did not respond. Try again; if it keeps failing, restart the computer.\n\nCode: ${code}`,
    canRetry: true,
  };
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

/** What crash recovery needs from Electron; injected so it can be tested without it. */
export interface SuperviseDeps {
  startBackend(): Promise<BackendHandle>;
  stopBackend(): Promise<void>;
  /** Point IPC (and the updater) at the backend that was started again. */
  replaced(backend: BackendHandle): void;
  /** Show "AIOS stopped working" with Restart and Quit. */
  askRestartOrQuit(errorCode: string): Promise<"retry" | "quit">;
  quit(): void;
  quitting(): boolean;
  now?(): number;
}

/** Restarts made without asking within RESTART_WINDOW_MS; one more asks Restart or Quit. */
export const QUIET_RESTARTS = 3;
export const RESTART_WINDOW_MS = 60_000;

/**
 * Crash recovery: a backend that exits while AIOS is open is started again with a new token,
 * and the window keeps working through the new one. Its data is safe on disk (chats.db is
 * written in transactions; the evidence writer and engine die with it, IPC-50, and restart with
 * it). A backend that keeps stopping is not restarted in a loop: the person chooses.
 */
export async function superviseBackend(first: BackendHandle, d: SuperviseDeps): Promise<void> {
  const now = d.now ?? Date.now;
  let backend = first;
  let recent: number[] = [];
  for (;;) {
    const code = await backend.exited;
    if (d.quitting()) return;
    const exitCode = `backend_exit_${code ?? "signal"}`;
    log("backend.exited", { errorCode: exitCode });
    const at = now();
    recent = [...recent.filter((t) => at - t < RESTART_WINDOW_MS), at];
    if (recent.length > QUIET_RESTARTS) {
      if ((await d.askRestartOrQuit(exitCode)) === "quit") return d.quit();
      recent = [];
    }
    for (;;) {
      try {
        backend = await d.startBackend();
        d.replaced(backend);
        log("backend.restarted");
        break;
      } catch (err) {
        await d.stopBackend();
        if (d.quitting()) return;
        if ((await d.askRestartOrQuit(errorCode(err))) === "quit") return d.quit();
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
