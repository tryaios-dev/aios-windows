import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Invariant 3 and SR-07: in the desktop app conversations live only in the encrypted store
 * (chats.db). The renderer must never copy them into browser storage, which Chromium keeps on
 * disk unencrypted. Only the plain-browser preview keeps its simulated workspace there.
 */
const WORKSPACE_KEY = "aios-sim-v1-workspace";
const SECRET = "the quarterly figures nobody may see";

async function freshStore(desktop: boolean) {
  vi.resetModules();
  localStorage.clear();
  if (desktop) (window as unknown as { aios: object }).aios = {};
  else delete (window as unknown as { aios?: object }).aios;
  return (await import("./store")).useStore;
}

function addMessageAfterSetup(useStore: Awaited<ReturnType<typeof freshStore>>) {
  useStore.setState((s) => ({
    ui: { ...s.ui, firstRunComplete: true, freshInstall: true },
    messages: [
      ...s.messages,
      { ...(s.messages[0] ?? {}), id: "m-secret", content: SECRET } as (typeof s.messages)[number],
    ],
  }));
}

afterEach(() => {
  vi.useRealTimers();
  delete (window as unknown as { aios?: object }).aios;
  localStorage.clear();
});

describe("workspace persistence", () => {
  it("desktop app: never writes conversations to browser storage", async () => {
    vi.useFakeTimers();
    const useStore = await freshStore(true);
    addMessageAfterSetup(useStore);
    vi.advanceTimersByTime(1000);
    window.dispatchEvent(new Event("pagehide"));
    expect(localStorage.getItem(WORKSPACE_KEY)).toBeNull();
    for (let i = 0; i < localStorage.length; i++) {
      expect(localStorage.getItem(localStorage.key(i) ?? "") ?? "").not.toContain(SECRET);
    }
  });

  it("desktop app: removes a workspace an older build left in browser storage", async () => {
    vi.resetModules();
    localStorage.clear();
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify({ messages: [{ content: SECRET }] }));
    (window as unknown as { aios: object }).aios = {};
    await import("./store");
    expect(localStorage.getItem(WORKSPACE_KEY)).toBeNull();
  });

  it("browser preview: keeps the simulated workspace across reloads", async () => {
    vi.useFakeTimers();
    const useStore = await freshStore(false);
    addMessageAfterSetup(useStore);
    vi.advanceTimersByTime(1000);
    expect(localStorage.getItem(WORKSPACE_KEY)).toContain(SECRET);
  });
});
