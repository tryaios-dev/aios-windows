import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { isPackaged: false, getVersion: () => "0.1.0" },
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
  dialog: { showOpenDialog: vi.fn() },
}));
vi.mock("electron-updater", () => ({ default: { autoUpdater: { on: vi.fn(), checkForUpdates: vi.fn() } } }));

const preload = readFileSync(path.join(import.meta.dirname, "../../src/preload/index.cts"), "utf8");

describe("ipc registry", () => {
  it("registers exactly the methods preload exposes", async () => {
    const { handlers } = await import("../../src/main/ipc/index.js");
    const exposed = [...preload.matchAll(/invoke\("([a-zA-Z.]+)"/g)].map((m) => m[1]).sort();
    expect(Object.keys(handlers).sort()).toEqual(exposed);
  });

  it("rejects a settings patch with unknown fields before it reaches the backend", async () => {
    const { handlers } = await import("../../src/main/ipc/index.js");
    const request = vi.fn();
    const backend = { apiPort: 1, client: { request } } as never;
    await expect(handlers["settings.update"]!(backend, { theme: "dark" })).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
});

describe("backend client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("throws the backend's error code", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: "store_exists" }), { status: 409 }));
    const { BackendClient } = await import("../../src/main/backend/client.js");
    await expect(new BackendClient(1, "t").request("POST", "/setup/store")).rejects.toThrow(/^store_exists$/);
  });

  it("falls back to the status when the body has no code", async () => {
    vi.stubGlobal("fetch", async () => new Response("oops", { status: 500 }));
    const { BackendClient } = await import("../../src/main/backend/client.js");
    await expect(new BackendClient(1, "t").request("GET", "/settings")).rejects.toThrow(/^backend_500$/);
  });
});
