import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ BrowserWindow: class {}, app: {}, shell: {} }));

describe("ac-10 renderer hardening", () => {
  it("CSP forbids network and remote script", async () => {
    const { CSP } = await import("../../src/main/window.js");
    expect(CSP).toContain("connect-src 'none'");
    expect(CSP).toContain("script-src 'self'");
    expect(CSP).not.toContain("unsafe-eval");
  });

  it("r-7 videos play only from blobs the window made, never from an address", async () => {
    const { CSP } = await import("../../src/main/window.js");
    const media = CSP.split("; ").find((d) => d.startsWith("media-src"));
    expect(media).toBe("media-src blob:");
  });
});
