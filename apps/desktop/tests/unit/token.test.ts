import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({}));

describe("launch token", () => {
  it("is 32 random bytes, stable for the process", async () => {
    const { launchToken } = await import("../../src/main/backend/token.js");
    const t = launchToken();
    expect(Buffer.from(t, "base64url")).toHaveLength(32);
    expect(launchToken()).toBe(t);
  });
});
