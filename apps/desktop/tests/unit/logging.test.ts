import { mkdtempSync, readFileSync, readdirSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({}));

/** M-21 / AC-20: Electron main's log is content-free, rotated, and kept within 14 days and 20 MB. */
describe("ac-20 main process log file", () => {
  afterEach(() => vi.resetModules());

  it("writes allow-listed fields only, to main.log in the shared logs folder", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "aios-logs-"));
    const { configureLogFile, log } = await import("../../src/main/logging.js");
    configureLogFile(dir);
    log("app.ready", { port: 123, prompt: "my secret question", token: "abc" });
    const text = readFileSync(path.join(dir, "main.log"), "utf8");
    expect(text).toContain('"event":"app.ready"');
    expect(text).toContain('"port":123');
    expect(text).not.toContain("secret");
    expect(text).not.toContain("abc");
  });

  it("names an event only, never a sentence", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "aios-logs-"));
    const { configureLogFile, log } = await import("../../src/main/logging.js");
    configureLogFile(dir);
    log("user asked about salaries");
    expect(readFileSync(path.join(dir, "main.log"), "utf8")).not.toContain("salaries");
  });

  it("rotates at its size limit and keeps one older file", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "aios-logs-"));
    const { configureLogFile, log } = await import("../../src/main/logging.js");
    const limit = 4096;
    configureLogFile(dir, limit);
    for (let i = 0; i < 400; i++) log("app.tick", { durationMs: i });
    const names = readdirSync(dir).sort();
    expect(names).toEqual(["main.log", "main.log.1"]);
    for (const name of names) expect(statSync(path.join(dir, name)).size).toBeLessThanOrEqual(limit);
  });

  it("removes log files older than 14 days at start", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "aios-logs-"));
    const old = path.join(dir, "backend.log.3");
    writeFileSync(old, "x");
    const fifteenDaysAgo = (Date.now() - 15 * 86_400_000) / 1000;
    utimesSync(old, fifteenDaysAgo, fifteenDaysAgo);
    writeFileSync(path.join(dir, "keep.txt"), "not a log");
    const { configureLogFile } = await import("../../src/main/logging.js");
    configureLogFile(dir);
    expect(readdirSync(dir).sort()).toEqual(["keep.txt"]); // main.log appears on the first line
  });
});
