import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const showSaveDialog = vi.fn();
vi.mock("electron", () => ({
  app: { isPackaged: false, getVersion: () => "0.1.0", getPath: () => tmpdir() },
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: (...args: unknown[]) => showSaveDialog(...args) },
}));
vi.mock("electron-updater", () => ({ default: { autoUpdater: { on: vi.fn(), checkForUpdates: vi.fn() } } }));

const KEY = "ABCD-EFGH-JKMN-PQRS-TVWX-YZ01-2345-67AB";
const backend = { apiPort: 1, client: { request: vi.fn() } } as never;

beforeEach(() => showSaveDialog.mockReset());

describe('"Save as a file" for the recovery key (test findings, issue 10)', () => {
  it("writes one .txt file where the person chose, and nothing anywhere else", async () => {
    const { handlers } = await import("../../src/main/ipc/index.js");
    const folder = mkdtempSync(path.join(tmpdir(), "aios-key-"));
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: path.join(folder, "My key") });
    await expect(handlers["setup.saveRecoveryKey"]!(backend, KEY)).resolves.toBe(true);
    expect(readdirSync(folder)).toEqual(["My key.txt"]); // no temporary or second file
    const text = readFileSync(path.join(folder, "My key.txt"), "utf8");
    expect(text).toContain("ABCD-EFGH-JKMN-PQRS\r\nTVWX-YZ01-2345-67AB"); // two rows of four, as on screen
    expect(text).toMatch(/not next to your backups/);
  });

  it("cancelling the dialog saves nothing", async () => {
    const { handlers } = await import("../../src/main/ipc/index.js");
    showSaveDialog.mockResolvedValue({ canceled: true, filePath: undefined });
    await expect(handlers["setup.saveRecoveryKey"]!(backend, KEY)).resolves.toBe(false);
  });

  it("anything that is not a recovery key is refused before the dialog, without repeating it", async () => {
    const { handlers } = await import("../../src/main/ipc/index.js");
    const secret = "not-a-key-but-maybe-secret";
    const error = await handlers["setup.saveRecoveryKey"]!(backend, secret).catch((e: Error) => e);
    expect((error as Error).message).toBe("invalid_recovery_key");
    expect(showSaveDialog).not.toHaveBeenCalled();
  });

  it("a key from AIOS 0.1.0 (nine groups) can be saved too", async () => {
    const { recoveryKeyFile } = await import("../../src/main/ipc/setup.js");
    const text = recoveryKeyFile(`${KEY}-CDEF`, new Date("2026-11-24T10:00:00Z"));
    expect(text).toContain("ABCD-EFGH-JKMN-PQRS\r\nTVWX-YZ01-2345-67AB-CDEF");
    expect(text).toContain("Saved on 2026-11-24.");
  });
});
