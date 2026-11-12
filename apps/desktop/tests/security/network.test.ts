import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CHROMIUM_SWITCHES, disableBackgroundNetworking } from "../../src/main/chromium.js";

/** C-01 / AC-21: Electron itself makes no network connections of its own. */
describe("ac-21 chromium background networking", () => {
  it("switches off every known background service", () => {
    const applied: string[] = [];
    disableBackgroundNetworking({ appendSwitch: (name) => void applied.push(name) });
    for (const name of [
      "disable-background-networking",
      "disable-component-update",
      "disable-domain-reliability",
      "no-pings",
      "dns-prefetch-disable",
      "disable-breakpad",
    ]) {
      expect(applied).toContain(name);
    }
    expect(applied).toHaveLength(CHROMIUM_SWITCHES.length);
  });

  it("is applied at start-up, before the app is ready", () => {
    const index = readFileSync(path.join(import.meta.dirname, "../../src/main/index.ts"), "utf8");
    const applied = index.indexOf("disableBackgroundNetworking(app.commandLine)");
    expect(applied).toBeGreaterThan(-1);
    expect(applied).toBeLessThan(index.indexOf("app.whenReady()"));
  });

  it("windows never spellcheck (dictionary downloads)", () => {
    const window = readFileSync(path.join(import.meta.dirname, "../../src/main/window.ts"), "utf8");
    expect(window).toContain("spellcheck: false");
  });

  it("never starts Electron's crash reporter", () => {
    const sources = ["index.ts", "window.ts", "startup.ts", "updater.ts"].map((f) =>
      readFileSync(path.join(import.meta.dirname, "../../src/main", f), "utf8"),
    );
    for (const text of sources) expect(text).not.toMatch(/crashReporter\.start/);
  });
});
