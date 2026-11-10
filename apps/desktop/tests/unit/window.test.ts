import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { isPackaged: false }, BrowserWindow: vi.fn(), shell: {} }));

describe("window permissions", () => {
  it("allow only writing to the clipboard", async () => {
    const { allowPermission, ALLOWED_PERMISSIONS } = await import("../../src/main/window.js");
    expect([...ALLOWED_PERMISSIONS]).toEqual(["clipboard-sanitized-write"]);
    expect(allowPermission("clipboard-sanitized-write")).toBe(true);
    for (const denied of ["clipboard-read", "media", "notifications", "geolocation", "openExternal"])
      expect(allowPermission(denied)).toBe(false);
  });
});
