import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { isPackaged: false, getVersion: () => "0.1.0" },
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
  dialog: { showOpenDialog: vi.fn(), showMessageBox: vi.fn(), showSaveDialog: vi.fn() },
  shell: { openExternal: vi.fn() },
}));
vi.mock("electron-updater", () => ({ default: { autoUpdater: { on: vi.fn(), checkForUpdates: vi.fn() } } }));

const ROOT = path.join(import.meta.dirname, "../../../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcd"; // 43 characters, like a launch token

/** SR-08, AC-11: script running in the renderer cannot recover the backend token. */
describe("ac-11 the renderer never holds the backend token", () => {
  it("the bridge contract and the preload expose nothing named token", () => {
    // Token counts (prompt_tokens, tokens_in) are fine; a field or method called "token" is not.
    for (const file of ["packages/ts/bridge-contract/src/index.ts", "apps/desktop/src/preload/index.cts"]) {
      expect(read(file)).not.toMatch(/\btoken\b\s*[:(]/i);
    }
  });

  it("no IPC handler returns the token, even when the backend echoes it", async () => {
    const { handlers } = await import("../../src/main/ipc/index.js");
    // A backend that answers every call with the token everywhere it could hide.
    const request = vi.fn(async () => ({ token: TOKEN, error: TOKEN, detail: TOKEN }));
    const backend = { apiPort: 1, client: { request } } as never;
    for (const [name, handler] of Object.entries(handlers)) {
      let result: unknown;
      try {
        result = await handler(backend, {});
      } catch (err) {
        result = String(err);
      }
      expect(JSON.stringify(result ?? null), name).not.toContain(TOKEN);
    }
  });
});
