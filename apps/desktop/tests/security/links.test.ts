import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * M-20 / AC-11: an external link from a model answer opens only after the user confirms it in a
 * dialog owned by Electron main. The renderer is untrusted (it renders model output), so a script
 * there calling the bridge directly still meets the confirmation, and only web links can open.
 */
const showMessageBox = vi.fn();
const openExternal = vi.fn();
vi.mock("electron", () => ({
  app: { isPackaged: false, getVersion: () => "0.1.0" },
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
  dialog: { showOpenDialog: vi.fn(), showMessageBox },
  shell: { openExternal },
}));
vi.mock("electron-updater", () => ({ default: { autoUpdater: { on: vi.fn(), checkForUpdates: vi.fn() } } }));

const backend = { apiPort: 1, client: { request: vi.fn() } } as never;

async function openLink(url: unknown) {
  const { handlers } = await import("../../src/main/ipc/index.js");
  return handlers["system.openLink"]!(backend, url);
}

beforeEach(() => {
  showMessageBox.mockReset();
  openExternal.mockReset();
});

describe("ac-11 external links", () => {
  it("opens a web link only after the user confirms in main's dialog", async () => {
    showMessageBox.mockResolvedValue({ response: 0 });
    await expect(openLink("https://example.org/a?b=1")).resolves.toBe(true);
    expect(showMessageBox).toHaveBeenCalledOnce();
    expect(JSON.stringify(showMessageBox.mock.calls[0])).toContain("example.org");
    expect(openExternal).toHaveBeenCalledWith("https://example.org/a?b=1");
  });

  it("opens nothing when the user cancels", async () => {
    showMessageBox.mockResolvedValue({ response: 1 });
    await expect(openLink("https://example.org/")).resolves.toBe(false);
    expect(openExternal).not.toHaveBeenCalled();
  });

  it.each(["file:///C:/Windows/System32/calc.exe", "javascript:alert(1)", "ms-settings:", "data:text/html,x", 42, ""])(
    "refuses %s without asking",
    async (url) => {
      await expect(openLink(url)).rejects.toThrow();
      expect(showMessageBox).not.toHaveBeenCalled();
      expect(openExternal).not.toHaveBeenCalled();
    },
  );

  it("refuses a link with credentials in it", async () => {
    await expect(openLink("https://user:pass@example.org/")).rejects.toThrow();
    expect(openExternal).not.toHaveBeenCalled();
  });
});
