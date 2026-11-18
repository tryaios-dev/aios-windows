import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { isPackaged: false } }));

const { E2E_DATA_ENV, withTestBackend } = await import("../../src/main/backend/spawn.js");
const desktop = { cmd: "python", args: ["-m", "aios_backend"], env: {} };

afterEach(() => {
  delete process.env[E2E_DATA_ENV];
});

describe("the real-window test backend (M-03)", () => {
  it("is used from source when the test sets its folder", () => {
    process.env[E2E_DATA_ENV] = "/tmp/aios-window/store";
    expect(withTestBackend(desktop, false).args).toEqual([
      "-m",
      "aios_backend.cli",
      "serve-e2e",
      "--echo",
      "--data",
      "/tmp/aios-window/store",
    ]);
  });

  it("is never used by the installed app, whatever the environment says", () => {
    process.env[E2E_DATA_ENV] = "/tmp/aios-window/store";
    expect(withTestBackend(desktop, true)).toBe(desktop);
  });

  it("changes nothing without the variable", () => {
    expect(withTestBackend(desktop, false)).toBe(desktop);
  });
});
