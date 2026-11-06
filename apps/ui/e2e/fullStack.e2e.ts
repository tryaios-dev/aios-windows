/**
 * Full stack, end to end: UI api (`src/bridge/api.ts`) → window.aios (the real preload) →
 * Electron main handlers (the real zod checks and HTTP client) → the real backend on a
 * throw-away database. Only Electron's IPC pipe and the system file dialogs are stood in for.
 *
 * The backend runs with `--echo`, a test-only answer source that repeats the question, because
 * the local engine is not part of this build. Everything else is the shipped code.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { currentPlatform } from "../../desktop/src/main/platform/index";
import { io } from "./electronStub";

const ROOT = path.resolve(import.meta.dirname, "../../..");
// The desktop platform layer knows where the dev Python is and how to stop the process tree.
const desktop = currentPlatform();
const PYTHON = desktop.backendCommand({ packaged: false, resourcesPath: "", repoRoot: ROOT }).cmd;

let backend: ChildProcess | undefined;
let data = "";

async function startBackend(): Promise<number> {
  data = mkdtempSync(path.join(tmpdir(), "aios-e2e-"));
  io.documents = data;
  const token = randomBytes(32).toString("base64url");
  backend = spawn(PYTHON, ["-m", "aios_backend.cli", "serve-e2e", "--echo", "--data", path.join(data, "store")], {
    stdio: ["pipe", "pipe", "ignore"],
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
  });
  backend.stdin!.end(JSON.stringify({ token, api_port: 0 }) + "\n");
  const port = await new Promise<number>((resolve, reject) => {
    const rl = createInterface({ input: backend!.stdout! });
    rl.on("line", (line) => line.startsWith("READY ") && resolve(JSON.parse(line.slice(6)).api_port));
    backend!.once("exit", (code) => reject(new Error(`backend exited ${code}`)));
  });
  const { BackendClient } = await import("../../desktop/src/main/backend/client");
  const { handlers } = await import("../../desktop/src/main/ipc/index");
  const handle = { apiPort: port, client: new BackendClient(port, token) };
  io.dispatch = async (method, args) => {
    if (!Object.hasOwn(handlers, method)) throw new Error("unknown_method");
    return handlers[method]!(handle, ...args);
  };
  await import("../../desktop/src/preload/index.cts"); // puts window.aios on the page
  return port;
}

// The UI modules are loaded after window.aios exists, as in the desktop app.
type Ui = {
  api: typeof import("../src/bridge/api").api;
  hydrate: typeof import("../src/bridge/live").hydrate;
  useStore: typeof import("../src/bridge/sim/store").useStore;
};
let ui: Ui;
const store = () => ui.useStore.getState();
const lastToast = () => store().toasts.at(-1);

beforeAll(async () => {
  if (!existsSync(PYTHON)) throw new Error(`run \`uv sync\` first: ${PYTHON} is missing`);
  await startBackend();
  const [{ api }, { hydrate }, { useStore }] = await Promise.all([
    import("../src/bridge/api"),
    import("../src/bridge/live"),
    import("../src/bridge/sim/store"),
  ]);
  ui = { api, hydrate, useStore };
});

afterAll(async () => {
  if (backend?.pid !== undefined && backend.exitCode === null) {
    const exited = new Promise((resolve) => backend!.once("exit", resolve));
    desktop.stopProcessTree(backend);
    await exited;
  }
  // Best effort: the OS may hold the new files for a moment (indexer, antivirus).
  try {
    if (data) rmSync(data, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch {
    console.warn(`e2e: could not remove ${data}; it is in the temp folder and safe to delete`);
  }
});

describe("desktop app against the real backend", () => {
  let projectId = "";
  let conversationId = "";

  it("starts on setup, with this machine's real hardware", async () => {
    await ui.hydrate();
    expect(store().ui.firstRunComplete).toBe(false);
    expect(store().hardware.cores).toBeGreaterThan(0);
    expect(store().settings.schema_version).toBeGreaterThanOrEqual(4);
    expect(store().liveAllowlist?.map((e) => e.id)).toEqual(["model-mirror", "update-feed", "company-server"]);
  });

  it("setup: creates the store, shows the recovery key once, finishes with the default project", async () => {
    ui.api.firstRun.begin();
    const issued = await ui.api.firstRun.issueRecoveryKey();
    expect(issued.ok && issued.key).toMatch(/^([0-9A-Z]{4}-){8}[0-9A-Z]{4}$/);
    const again = await ui.api.firstRun.issueRecoveryKey();
    expect(!again.ok && again.alreadyIssued).toBe(true);

    expect(await ui.api.firstRun.complete({ installedModelId: null })).toBe(true);
    expect(store().ui.firstRunComplete).toBe(true);
    const workspace = store().projects.find((p) => p.name === "My workspace");
    expect(workspace?.classification).toBe("restricted");
    expect(store().ui.lastProjectId).toBe(workspace?.id);
    const types = store().events.map((e) => e.event_type);
    expect(types).toEqual(
      expect.arrayContaining(["store_created", "recovery_package_written", "recovery_key_issued", "project_created"]),
    );
    expect(store().events.every((e) => e.pending)).toBe(true); // the evidence writer is not in this build
  });

  it("settings: a change is saved in the backend and survives a reload", async () => {
    await ui.api.settings.update({ safe_mode_cpu: true, update_check: false });
    expect(store().settings.safe_mode_cpu).toBe(true);
    ui.useStore.setState((s) => ({ settings: { ...s.settings, safe_mode_cpu: false } }));
    await ui.hydrate();
    expect(store().settings.safe_mode_cpu).toBe(true);
    expect(store().settings.update_check).toBe(false);
    await ui.api.settings.update({ safe_mode_cpu: false });
  });

  it("projects: create, rename, archive, reclassify (lowering makes a reviewed copy)", async () => {
    const created = await ui.api.projects.create({ name: "Supplier FAQ", classification: "internal" });
    expect(created?.classification).toBe("internal");
    projectId = created!.id;
    expect(store().projects.some((p) => p.id === projectId)).toBe(true);

    ui.api.projects.rename(projectId, "Supplier answers");
    await vi.waitFor(() => expect(store().projects.find((p) => p.id === projectId)?.name).toBe("Supplier answers"));

    ui.api.projects.archive(projectId, true);
    await vi.waitFor(() => expect(store().projects.find((p) => p.id === projectId)?.archived).toBe(true));
    ui.api.projects.archive(projectId, false);
    await vi.waitFor(() => expect(store().projects.find((p) => p.id === projectId)?.archived).toBe(false));

    const lowered = await ui.api.projects.reclassify(projectId, "public");
    expect(lowered?.reviewedCopy).toBe(true);
    expect(lowered?.project.derived_from_project_id).toBe(projectId);
    expect(store().projects.find((p) => p.id === projectId)?.classification).toBe("internal");
  });

  it("projects: Company AI is refused while the provider flag is off", async () => {
    const before = store().toasts.length;
    ui.api.projects.setCompanyAi(projectId, true, true);
    await vi.waitFor(() => expect(store().toasts.length).toBeGreaterThan(before));
    expect(lastToast()?.description).toMatch(/Company AI is not available/);
  });

  it("chat: start a conversation, send, get the answer, rename, regenerate", async () => {
    const conv = await ui.api.conversations.create(projectId);
    expect(conv?.project_id).toBe(projectId);
    conversationId = conv!.id;
    expect(store().conversations.some((c) => c.id === conversationId)).toBe(true);

    expect(await ui.api.conversations.send(conversationId, "Where is the supplier price list?")).toEqual({ ok: true });
    const messages = ui.api.conversations.messages(conversationId);
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(messages[1]!.content).toBe("You said: Where is the supplier price list?");
    expect(store().events.some((e) => e.event_type === "request" && e.conversation_id === conversationId)).toBe(true);

    ui.api.conversations.rename(conversationId, "Price list");
    await vi.waitFor(() =>
      expect(store().conversations.find((c) => c.id === conversationId)?.title).toBe("Price list"),
    );

    ui.api.conversations.regenerate(conversationId);
    await vi.waitFor(() => expect(ui.api.conversations.messages(conversationId)[1]?.previous_versions).toHaveLength(1));
  });

  it("chat: a message too large for the model is refused and recorded", async () => {
    const result = await ui.api.conversations.send(conversationId, "word ".repeat(20_000));
    expect(result).toMatchObject({ ok: false, reason: "too_large" });
    expect(store().events.some((e) => e.event_type === "refusal")).toBe(true);
  });

  it("search: finds the message through the backend", async () => {
    const hits = await ui.api.search("price list");
    expect(hits.map((h) => h.conversation_id)).toContain(conversationId);
    expect(hits[0]!.snippet.toLowerCase()).toContain("price list");
  });

  it("evidence: project events come from the backend; export waits for the writer", async () => {
    expect(ui.api.projects.evidence(projectId).length).toBeGreaterThan(0);
    await expect(ui.api.projects.exportEvidence({ project_id: projectId })).rejects.toThrow(/evidence writer/);
  });

  it("packages: export to the file chosen in the save dialog, import it back as a new project", async () => {
    const file = path.join(data, "supplier.aiosproj");
    io.nextSave.push(file);
    const exported = await ui.api.projects.exportPackage(projectId);
    expect(exported.path).toBe(file);
    expect(existsSync(file)).toBe(true);

    io.nextOpen.push(file);
    const picked = await ui.api.projects.choosePackage();
    expect(picked?.file_name).toBe("supplier.aiosproj");
    const imported = await ui.api.projects.importPackage(picked!.path);
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.result.messages).toBeGreaterThanOrEqual(2);
    expect(store().projects.some((p) => p.id === imported.result.project_id)).toBe(true);
    expect(await ui.api.search("price list")).toHaveLength(4); // original + imported copy
  });

  it("models: a file that is not a catalogue model is refused; download is not in this build", async () => {
    const fake = path.join(data, "not-a-model.gguf");
    writeFileSync(fake, "GGUF fake");
    io.nextOpen.push(fake);
    await ui.api.models.importOffline("qwen3-4b-q4km");
    await vi.waitFor(() => expect(lastToast()?.title).toBe("Model not installed"));
    expect(lastToast()?.description).toMatch(/size is different/);
    expect(store().installedModels).toEqual([]);

    ui.api.models.download("qwen3-4b-q4km");
    await vi.waitFor(() => expect(lastToast()?.description).toMatch(/model mirror is not set up/));
  });

  it("deleting a conversation and a project removes them everywhere", async () => {
    ui.api.conversations.remove(conversationId);
    await vi.waitFor(() => expect(store().conversations.some((c) => c.id === conversationId)).toBe(false));
    expect(ui.api.conversations.messages(conversationId)).toEqual([]);

    ui.api.projects.remove(projectId);
    await vi.waitFor(() => expect(store().projects.some((p) => p.id === projectId)).toBe(false));
    await vi.waitFor(() =>
      expect(store().events.map((e) => e.event_type)).toEqual(
        expect.arrayContaining(["conversation_deleted", "project_deleted"]),
      ),
    );
  });

  it("a fresh start of the UI shows the same workspace (nothing lives only in the browser)", async () => {
    ui.useStore.setState({ projects: [], conversations: [], events: [] });
    await ui.hydrate();
    expect(store().projects.map((p) => p.name)).toContain("My workspace");
    expect(store().events.length).toBeGreaterThan(5);
  });
});
