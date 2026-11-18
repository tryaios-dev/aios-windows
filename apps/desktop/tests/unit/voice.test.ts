import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { isPackaged: false, getVersion: () => "0.1.0" },
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
  dialog: { showOpenDialog: vi.fn() },
}));
vi.mock("electron-updater", () => ({ default: { autoUpdater: { on: vi.fn(), checkForUpdates: vi.fn() } } }));

const SESSION = "0123456789abcdef0123456789abcdef";

async function setup(reply: unknown) {
  const { handlers } = await import("../../src/main/ipc/index.js");
  const request = vi.fn(async () => reply);
  const backend = { apiPort: 1, client: { request } } as never;
  return { handlers, request, backend };
}

describe("voice handlers (ADR 0016)", () => {
  it("send the audio to the backend as base64 and return the text so far", async () => {
    const { handlers, request, backend } = await setup({ text: "Hello", pending: true });
    const pcm = new Uint8Array([1, 0, 2, 0]);
    expect(await handlers["voice.audio"]!(backend, SESSION, pcm)).toEqual({ text: "Hello", pending: true });
    expect(request).toHaveBeenCalledWith("POST", `/voice/sessions/${SESSION}/audio`, { pcm: "AQACAA==" });
  });

  it.each([
    ["not bytes", "AQACAA=="],
    ["an odd number of bytes", new Uint8Array(3)],
    ["more than 2 s of audio", new Uint8Array(64_002)],
  ])("refuse %s before it reaches the backend", async (_what, pcm) => {
    const { handlers, request, backend } = await setup({ text: "", pending: false });
    await expect(handlers["voice.audio"]!(backend, SESSION, pcm)).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });

  it.each(["../setup", "abc", `${SESSION}/finish`])("refuse a session id like %s", async (id) => {
    const { handlers, request, backend } = await setup({ text: "" });
    await expect(handlers["voice.finish"]!(backend, id)).rejects.toThrow();
    await expect(handlers["voice.cancel"]!(backend, id)).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });

  it("start, finish and cancel map to the backend's endpoints", async () => {
    const { handlers, request, backend } = await setup({ session_id: SESSION });
    expect(await handlers["voice.start"]!(backend)).toEqual({ session_id: SESSION });
    expect(request).toHaveBeenLastCalledWith("POST", "/voice/sessions");
    request.mockResolvedValueOnce({ text: "All of it." } as never);
    expect(await handlers["voice.finish"]!(backend, SESSION)).toEqual({ text: "All of it." });
    expect(request).toHaveBeenLastCalledWith("POST", `/voice/sessions/${SESSION}/finish`);
    request.mockResolvedValueOnce(undefined as never);
    await handlers["voice.cancel"]!(backend, SESSION);
    expect(request).toHaveBeenLastCalledWith("DELETE", `/voice/sessions/${SESSION}`);
  });

  it("validate what the backend answers", async () => {
    const { handlers, backend } = await setup({ state: "listening_secretly", build: null });
    await expect(handlers["voice.status"]!(backend)).rejects.toThrow();
  });
});
