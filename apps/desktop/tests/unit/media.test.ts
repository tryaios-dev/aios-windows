import { describe, expect, it, vi } from "vitest";

const showSaveDialog = vi.fn();
vi.mock("electron", () => ({
  app: { isPackaged: false, getVersion: () => "0.1.0", getPath: () => "C:\\Users\\me\\Documents" },
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: (...args: unknown[]) => showSaveDialog(...args) },
}));
vi.mock("electron-updater", () => ({ default: { autoUpdater: { on: vi.fn(), checkForUpdates: vi.fn() } } }));

const ITEM = {
  id: "0f3c2a1b-0000-4000-8000-000000000001",
  project_id: "p1",
  kind: "image",
  model: "flux-schnell",
  prompt: "a lighthouse",
  negative_prompt: null,
  width: 1024,
  height: 1024,
  frames: null,
  seed: 7,
  status: "done",
  progress: 1,
  position: null,
  error_code: null,
  mime: "image/png",
  size_bytes: 10,
  created_at: "2026-11-19T10:00:00Z",
  finished_at: "2026-11-19T10:00:09Z",
};

const backend = (request: ReturnType<typeof vi.fn>) => ({ apiPort: 1, client: { request } }) as never;

describe("r-7 media handlers", () => {
  it("refuse a request with extra fields before it reaches the backend", async () => {
    const { handlers } = await import("../../src/main/ipc/index.js");
    const request = vi.fn();
    const input = {
      kind: "image",
      model: "flux-schnell",
      prompt: "x",
      width: 1024,
      height: 1024,
      confirmed: true,
      workflow: { "1": {} },
    };
    await expect(handlers["media.create"]!(backend(request), "p1", input)).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });

  it("refuse an id that is not a plain id before it goes into a path", async () => {
    const { handlers } = await import("../../src/main/ipc/index.js");
    const request = vi.fn();
    await expect(handlers["media.get"]!(backend(request), "../setup/store")).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });

  it("save asks where in the system dialog, then the backend writes the copy", async () => {
    const { handlers } = await import("../../src/main/ipc/index.js");
    const request = vi.fn(async (method: string, path: string) =>
      method === "GET" ? ITEM : { path: "C:\\Users\\me\\Documents\\x.png", size_bytes: 10 },
    );
    showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: "C:\\Users\\me\\Documents\\x" });
    const saved = await handlers["media.save"]!(backend(request), ITEM.id);
    expect(saved).toEqual({ path: "C:\\Users\\me\\Documents\\x.png", size_bytes: 10 });
    expect(request).toHaveBeenLastCalledWith("POST", `/media/${ITEM.id}/save`, {
      path: "C:\\Users\\me\\Documents\\x.png",
    });
  });

  it("save does nothing when the dialog is cancelled", async () => {
    const { handlers } = await import("../../src/main/ipc/index.js");
    const request = vi.fn(async () => ITEM);
    showSaveDialog.mockResolvedValueOnce({ canceled: true });
    expect(await handlers["media.save"]!(backend(request), ITEM.id)).toBeNull();
    expect(request).toHaveBeenCalledTimes(1); // only the GET to learn the file type
  });
});
