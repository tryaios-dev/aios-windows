import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { isPackaged: false, getVersion: () => "0.2.0" } }));
vi.mock("electron-updater", () => ({ default: { autoUpdater: { on: vi.fn(), checkForUpdates: vi.fn() } } }));

/** M-18 / AC-21 / C-04: automatic update checks at start and at most once a day, never downgrading. */
describe("ac-21 update check schedule", () => {
  const now = Date.parse("2026-11-12T10:00:00Z");

  it("checks when it has never checked, or a day has passed", async () => {
    const { checkIsDue } = await import("../../src/main/updater.js");
    expect(checkIsDue({ update_check: true, last_update_check: null }, now)).toBe(true);
    expect(checkIsDue({ update_check: true, last_update_check: "2026-11-11T09:59:00Z" }, now)).toBe(true);
  });

  it("twenty restarts in a day give one check: within 24 hours of the last one it waits", async () => {
    const { checkIsDue } = await import("../../src/main/updater.js");
    expect(checkIsDue({ update_check: true, last_update_check: "2026-11-12T08:00:00Z" }, now)).toBe(false);
  });

  it("never checks while the switch is off (air-gapped machines)", async () => {
    const { checkIsDue } = await import("../../src/main/updater.js");
    expect(checkIsDue({ update_check: false, last_update_check: null }, now)).toBe(false);
  });

  it("refuses a version that is not newer than the running one", async () => {
    const { isNewer } = await import("../../src/main/updater.js");
    expect(isNewer("0.2.1", "0.2.0")).toBe(true);
    expect(isNewer("1.0.0", "0.9.9")).toBe(true);
    expect(isNewer("0.2.0", "0.2.0")).toBe(false);
    expect(isNewer("0.1.9", "0.2.0")).toBe(false);
    expect(isNewer("not-a-version", "0.2.0")).toBe(false);
  });

  it("never allows a downgrade or a pre-release from the feed", async () => {
    const { configureUpdater } = await import("../../src/main/updater.js");
    const target = { autoDownload: true, allowDowngrade: true, allowPrerelease: true };
    configureUpdater(target, true);
    expect(target).toEqual({ autoDownload: true, allowDowngrade: false, allowPrerelease: false });
  });
});
