import { spawn, type ChildProcess } from "node:child_process";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { isPackaged: false } }));

// A fake backend: a Node process that reads its stdin and never prints READY.
const started: ChildProcess[] = [];
vi.mock("../../src/main/platform/index.js", () => ({
  currentPlatform: () => ({
    backendCommand: () => ({
      cmd: process.execPath,
      args: ["-e", "process.stdin.resume(); setInterval(() => {}, 1000)"],
      env: process.env,
    }),
    stopProcessTree: (c: ChildProcess) => {
      started.push(c);
      c.kill();
    },
  }),
}));

const { BACKEND_START_TIMEOUT_MS, startBackend, stopBackend } = await import("../../src/main/backend/spawn.js");
const { onSecondInstance, runStartup } = await import("../../src/main/startup.js");
type Deps = Parameters<typeof runStartup>[0];

const exited = (c: ChildProcess) =>
  c.exitCode !== null || c.signalCode !== null ? Promise.resolve() : new Promise((r) => c.once("exit", r));

function deps(over: Partial<Deps>): Deps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    showStarting: () => void calls.push("starting"),
    startBackend: async () => ({ apiPort: 1, client: {} as never }),
    stopBackend: async () => void calls.push("stop"),
    openApp: async () => void calls.push("open"),
    askRetryOrQuit: async (code) => (calls.push(`ask:${code}`), "quit"),
    quit: () => void calls.push("quit"),
    quitting: () => false,
    ...over,
  };
}

describe("app start-up (bug 1: no window on a slow first start)", () => {
  it("waits 120 s for the backend, as the contract says", () => {
    expect(BACKEND_START_TIMEOUT_MS).toBe(120_000);
  });

  it("a backend that never prints READY gives the error screen, and Quit leaves no process", async () => {
    const d = deps({ startBackend: () => startBackend(300), stopBackend });
    const result = await runStartup(d);
    expect(result).toBeNull();
    expect(d.calls).toEqual(["starting", "ask:backend_start_timeout", "quit"]);
    expect(started).toHaveLength(1);
    await exited(started[0]!);
    expect(started[0]!.exitCode !== null || started[0]!.signalCode !== null).toBe(true);
  });

  it("shows the start-up window before the backend starts", async () => {
    const d = deps({});
    d.startBackend = async () => {
      expect(d.calls).toEqual(["starting"]);
      return { apiPort: 1, client: {} as never };
    };
    expect(await runStartup(d)).not.toBeNull();
    expect(d.calls).toEqual(["starting", "open"]);
  });

  it("Retry starts the backend again and then opens the app", async () => {
    let attempts = 0;
    const d = deps({
      startBackend: async () => {
        if (++attempts === 1) throw new Error("backend_exit_1");
        return { apiPort: 1, client: {} as never };
      },
      askRetryOrQuit: async (code) => (d.calls.push(`ask:${code}`), "retry"),
    });
    expect(await runStartup(d)).not.toBeNull();
    expect(d.calls).toEqual(["starting", "stop", "ask:backend_exit_1", "starting", "open"]);
  });

  it("asks nothing when the user already closed AIOS", async () => {
    const d = deps({ startBackend: async () => Promise.reject(new Error("backend_exit_1")), quitting: () => true });
    expect(await runStartup(d)).toBeNull();
    expect(d.calls).toEqual(["starting", "stop"]);
  });

  it("never shows an error message's text, only a code", async () => {
    const d = deps({ startBackend: async () => Promise.reject(new Error("spawn C:\\some path ENOENT")) });
    await runStartup(d);
    expect(d.calls).toContain("ask:backend_start_failed");
  });
});

describe("second launch", () => {
  const win = () => ({ isMinimized: () => true, restore: vi.fn(), show: vi.fn(), focus: vi.fn() });

  it("opens a window when none exists", () => {
    const reopen = vi.fn();
    onSecondInstance([], reopen);
    expect(reopen).toHaveBeenCalledOnce();
  });

  it("brings the existing window forward", () => {
    const w = win();
    const reopen = vi.fn();
    onSecondInstance([w], reopen);
    expect(reopen).not.toHaveBeenCalled();
    expect(w.restore).toHaveBeenCalled();
    expect(w.focus).toHaveBeenCalled();
  });
});
