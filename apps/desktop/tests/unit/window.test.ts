import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { isPackaged: false }, BrowserWindow: vi.fn(), shell: {} }));

describe("window permissions", () => {
  it("allow only writing to the clipboard, and the microphone", async () => {
    const { allowPermission, ALLOWED_PERMISSIONS } = await import("../../src/main/window.js");
    expect([...ALLOWED_PERMISSIONS]).toEqual(["clipboard-sanitized-write"]);
    expect(allowPermission("clipboard-sanitized-write")).toBe(true);
    for (const denied of ["clipboard-read", "notifications", "geolocation", "openExternal", "display-capture"])
      expect(allowPermission(denied)).toBe(false);
  });

  it("allow the microphone for speaking instead of typing, never the camera (ADR 0016)", async () => {
    const { allowPermission } = await import("../../src/main/window.js");
    // Request handler: the kinds of media asked for.
    expect(allowPermission("media", { mediaTypes: ["audio"] })).toBe(true);
    expect(allowPermission("media", { mediaTypes: ["video"] })).toBe(false);
    expect(allowPermission("media", { mediaTypes: ["audio", "video"] })).toBe(false);
    expect(allowPermission("media", { mediaTypes: [] })).toBe(false);
    expect(allowPermission("media", {})).toBe(false);
    expect(allowPermission("media")).toBe(false);
    // Check handler: one kind at a time.
    expect(allowPermission("media", { mediaType: "audio" })).toBe(true);
    expect(allowPermission("media", { mediaType: "video" })).toBe(false);
    expect(allowPermission("media", { mediaType: "unknown" })).toBe(false);
  });
});
