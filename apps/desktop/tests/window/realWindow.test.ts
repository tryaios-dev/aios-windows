/**
 * M-03: the real app in a real window. Electron starts from source with the built UI, the real
 * preload and main, and the throw-away e2e backend (test profile, own temp folder, never the key
 * store or anyone's data; see withTestBackend in src/main/backend/spawn.ts). Playwright drives
 * the window. The full-stack suite (apps/ui/e2e) covers every feature in detail; this one proves
 * the pieces work together in Electron itself.
 *
 * Run with `pnpm --filter @aios/desktop test:window` (builds the UI and main first).
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { _electron as electron, type ElectronApplication, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const APP_DIR = path.resolve(import.meta.dirname, "../..");
const electronBinary = createRequire(import.meta.url)("electron") as unknown as string;
// Electron needs a display; Linux CI runners have none.
const canOpenWindow = process.platform !== "linux" || Boolean(process.env.DISPLAY);

let app: ElectronApplication;
let page: Page;
let data = "";
/** What the page reported as refused by its Content Security Policy. */
const refused: string[] = [];

const netLog = () => path.join(data, "net-log.json");

/** Every address in a Chromium network log that is not this computer or the app's own files. */
export function outsideAddresses(log: string): string[] {
  const found = new Set<string>();
  for (const m of log.matchAll(/"(?:url|original_url|host|origin)":"([^"]+)"/g)) {
    const value = m[1]!;
    if (/^(file|data|devtools|chrome|chrome-extension|about|blob):/i.test(value)) continue;
    const host = value.replace(/^[a-z]+:\/\//i, "").replace(/[/:?].*$/, "").replace(/^\[|\]$/g, "");
    if (["127.0.0.1", "localhost", "::1", ""].includes(host)) continue;
    // Finding the Windows system proxy (WPAD: a DHCP query and a "wpad" name lookup on the local
    // network, no request sent). Network allowlist v1 rule 5: the system proxy is used if
    // configured, so its discovery is allowed; it carries no content.
    if (host === "wpad") continue;
    found.add(host);
  }
  return [...found].sort();
}

/** What Electron main and the backend printed (the backend's stderr is inherited by main), so a
 * start that fails on a CI runner says why instead of only "did not open". */
const output: string[] = [];
const lastOutput = () => output.join("").split(/\r?\n/).filter(Boolean).slice(-40).join("\n");

/** Longer than the app's own wait for the backend (BACKEND_START_TIMEOUT_MS, 120 s in
 * src/main/backend/spawn.ts) plus opening the window, so a slow cold start on a CI runner is not
 * cut short by the test before the app itself would have given up. */
const MAIN_WINDOW_WAIT_MS = 180_000;

/** The main window (the small "Starting AIOS…" window comes first and closes). */
async function mainWindow(a: ElectronApplication): Promise<Page> {
  const deadline = Date.now() + MAIN_WINDOW_WAIT_MS;
  while (Date.now() < deadline) {
    const found = a.windows().find((w) => w.url().endsWith("index.html"));
    if (found) return found;
    await new Promise((r) => setTimeout(r, 500));
  }
  const open = a.windows().map((w) => w.url().slice(0, 80));
  throw new Error(
    `the main window did not open within ${MAIN_WINDOW_WAIT_MS / 1000} s ` +
      `(open windows: ${JSON.stringify(open)})\n--- app output ---\n${lastOutput()}`,
  );
}

beforeAll(async () => {
  if (!canOpenWindow) return;
  data = mkdtempSync(path.join(tmpdir(), "aios-window-"));
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== "ELECTRON_RUN_AS_NODE") env[k] = v;
  env.AIOS_E2E_DATA = path.join(data, "store");
  app = await electron.launch({ executablePath: electronBinary, // Its own profile folder: a copy of AIOS already open on this computer is not disturbed.
  // Chromium's own network log for the whole run (C-01, L-02): every connection the app's
  // Chromium side makes, read after the app has closed.
  args: [APP_DIR, `--user-data-dir=${path.join(data, "electron")}`, `--log-net-log=${netLog()}`], env, timeout: 180_000 });
  for (const stream of [app.process().stdout, app.process().stderr]) {
    stream?.on("data", (chunk: Buffer) => output.push(chunk.toString("utf8")));
  }
  page = await mainWindow(app);
  page.on("console", (m) => {
    if (m.type() === "error" && m.text().startsWith("Refused to")) refused.push(m.text().slice(0, 120));
  });
  await page.waitForLoadState("domcontentloaded");
}, 400_000); // electron.launch (up to 180 s) + MAIN_WINDOW_WAIT_MS

afterAll(async () => {
  await app?.close().catch(() => undefined);
  try {
    if (data) rmSync(data, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch {
    /* in the temp folder; safe to leave */
  }
});

describe.runIf(canOpenWindow)("M-03: AIOS in a real window", () => {
  it("opens on first-run setup, with no Node in the page and only window.aios", async () => {
    const seen = await page.evaluate(() => ({
      aios: typeof (window as unknown as { aios?: unknown }).aios,
      require: typeof (window as unknown as { require?: unknown }).require,
      process: typeof (window as unknown as { process?: unknown }).process,
    }));
    expect(seen).toEqual({ aios: "object", require: "undefined", process: "undefined" });
    const status = await page.evaluate(() => window.aios.setup.status());
    expect(status.first_run_complete).toBe(false);
  });

  it("sets up, then asks a question and gets the answer, through preload, main and the backend", async () => {
    const answer = await page.evaluate(async () => {
      const created = await window.aios.setup.createStore();
      await window.aios.setup.complete();
      const project = await window.aios.projects.create({ name: "Window test", classification: "internal" });
      const conv = await window.aios.conversations.create(project.id);
      const exchange = await window.aios.conversations.send(conv.id, "hello from a real window");
      return { key: created.recovery_key.length > 0, text: exchange.assistant.content };
    });
    expect(answer.key).toBe(true);
    expect(answer.text).toContain("hello from a real window"); // the e2e backend repeats the question
  }, 60_000);

  it("after a reload the app shows the project it saved", async () => {
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    // Setup was finished through the bridge, not by clicking, so the window is still on the
    // setup route: open the app's start page now that the reloaded window knows setup is done.
    await page.locator("#root > *").first().waitFor(); // drawn once hydrate has loaded the status
    await page.evaluate(() => {
      location.hash = "#/";
    });
    await page.getByText("Window test").first().waitFor({ timeout: 30_000 });
  }, 60_000);

  it("loads everything it needs within its strict Content Security Policy", () => {
    expect(refused).toEqual([]);
  });

  it("talks to nothing outside this computer, in use and while idle (C-01, L-02 network capture)", async () => {
    await page.waitForTimeout(15_000); // idle: background services would show up here
    await app.close();
    const log = readFileSync(netLog(), "utf8");
    expect(log.length).toBeGreaterThan(0);
    expect(outsideAddresses(log)).toEqual([]);
  }, 90_000);
});
