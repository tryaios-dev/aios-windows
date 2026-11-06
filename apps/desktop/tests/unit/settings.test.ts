import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({}));

const { settingsHandlers } = await import("../../src/main/ipc/settings.js");

function backend(response: unknown) {
  const request = vi.fn().mockResolvedValue(response);
  return { handle: { client: { request } } as never, request };
}

describe("settings IPC (D-06 Safe mode)", () => {
  it("passes a valid change to the backend", async () => {
    const { handle, request } = backend({ safe_mode: true });
    expect(await settingsHandlers["settings.setEngine"]!(handle, { safe_mode: true })).toEqual({ safe_mode: true });
    expect(request).toHaveBeenCalledWith("PUT", "/settings/engine", { safe_mode: true });
  });

  it("rejects anything else before it reaches the backend", async () => {
    for (const bad of [undefined, {}, { safe_mode: "yes" }, { safe_mode: true, extra: 1 }]) {
      const { handle, request } = backend({ safe_mode: true });
      await expect(settingsHandlers["settings.setEngine"]!(handle, bad)).rejects.toThrow();
      expect(request).not.toHaveBeenCalled();
    }
  });

  it("validates what the backend returns", async () => {
    const { handle } = backend({ safe_mode: "on" });
    await expect(settingsHandlers["settings.engine"]!(handle)).rejects.toThrow();
  });
});
