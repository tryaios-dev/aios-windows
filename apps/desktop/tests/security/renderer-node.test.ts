import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { isPackaged: false }, BrowserWindow: vi.fn(), shell: {} }));

const { RENDERER_PREFERENCES } = await import("../../src/main/window.js");
// In plain Node, the electron package resolves to the path of the Electron binary.
const electronBinary = createRequire(import.meta.url)("electron") as unknown as string;
const probe = path.join(import.meta.dirname, "fixtures", "renderer-probe.cjs");
// Electron needs a display; Linux CI runners have none, Windows runners do.
const canOpenWindow = process.platform !== "linux" || Boolean(process.env.DISPLAY);

describe("C-01: Node is unreachable from the renderer", () => {
  it("the main window is isolated and sandboxed, with no Node anywhere", () => {
    expect(RENDERER_PREFERENCES).toMatchObject({
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webviewTag: false,
    });
  });

  it.runIf(canOpenWindow)("a page in a real window sees no require, process, module or Buffer", () => {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const run = spawnSync(electronBinary, [probe, JSON.stringify(RENDERER_PREFERENCES)], {
      env,
      encoding: "utf8",
      timeout: 60_000,
    });
    const line = run.stdout.split(/\r?\n/).find((l) => l.startsWith("PROBE "));
    expect(line, run.stderr).toBeDefined();
    expect(JSON.parse(line!.slice(6))).toEqual({
      require: "undefined",
      process: "undefined",
      module: "undefined",
      Buffer: "undefined",
      global: "undefined",
      electron: "undefined",
    });
  }, 90_000);
});
