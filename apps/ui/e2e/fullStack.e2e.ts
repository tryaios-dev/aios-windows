/**
 * Full stack, end to end: UI api (`src/lib/api.ts`) → window.aios (the real preload) →
 * Electron main handlers (the real zod checks and HTTP client) → the real backend on a
 * throw-away database. Only Electron's IPC pipe and the system file dialogs are stood in for.
 *
 * The backend runs with `--echo`, a test-only answer source that repeats the question, because
 * the local engine is not part of this build. Everything else is the shipped code.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
  api: typeof import("../src/lib/api").api;
  hydrate: typeof import("../src/bridge/live").hydrate;
  useStore: typeof import("../src/lib/store").useStore;
};
let ui: Ui;

/** Changes reload in the background; give them time on a busy machine (CI runners included). */
const eventually = (check: () => void) => vi.waitFor(check, { timeout: 5_000, interval: 50 });
const store = () => ui.useStore.getState();
const lastToast = () => store().toasts.at(-1);

beforeAll(async () => {
  if (!existsSync(PYTHON)) throw new Error(`run \`uv sync\` first: ${PYTHON} is missing`);
  await startBackend();
  const [{ api }, { hydrate }, { useStore }] = await Promise.all([
    import("../src/lib/api"),
    import("../src/bridge/live"),
    import("../src/lib/store"),
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

  it("starts on setup, with this machine's real hardware and the backend's list of AI models", async () => {
    await ui.hydrate();
    const { CATALOGUE } = await import("../src/data/catalogue");
    expect(CATALOGUE.map((e) => e.entry_id)).toContain("minicpm5-2b-q4_k_m-openbmb-gguf"); // nothing listed by hand
    expect(store().ui.firstRunComplete).toBe(false);
    expect(store().hardware.cores).toBeGreaterThan(0);
    expect(store().settings.schema_version).toBeGreaterThanOrEqual(4);
    const ids = store().live?.allowlist.map((e) => e.id) ?? [];
    expect(ids.slice(0, 3)).toEqual(["model-mirror", "update-feed", "model-origin"]); // Hugging Face
    expect(ids.at(-1)).toBe("company-server");
  });

  it("setup: creates the store, shows the recovery key once, finishes with the default project", async () => {
    const issued = await ui.api.firstRun.issueRecoveryKey();
    expect(issued.ok && issued.key).toMatch(/^([0-9A-Z]{4}-){8}[0-9A-Z]{4}$/);
    const again = await ui.api.firstRun.issueRecoveryKey();
    expect(!again.ok && again.alreadyIssued).toBe(true);

    expect(await ui.api.firstRun.complete()).toBe(true);
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

  it("settings: Data, About, Health and General show the backend's facts, not simulated ones", async () => {
    // Data: the evidence stream and epoch the backend holds.
    expect(store().stream.epoch).toBe(1);
    expect(store().stream.stream_id).toMatch(/^[0-9a-f-]{36}$/);
    // About: licences follow the bundled catalogue; General: its version, never checked yet.
    const names = store().live?.licences.map((l) => l.name) ?? [];
    expect(names).toEqual(expect.arrayContaining(["llama.cpp", "SQLCipher", "Electron"]));
    expect(store().settings.catalogue_version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(store().settings.last_catalogue_check).toBeNull();
    // Health: the Company AI row follows the backend's provider flag (off here).
    expect(store().health.company.enabled).toBe(false);

    // General > Check now works while the automatic update check is switched off (previous test).
    // It also asks for newly listed AI models; with no mirror in this build the bundled list stays.
    expect(store().settings.update_check).toBe(false);
    await ui.api.settings.checkForUpdates();
    expect(store().settings.last_update_check).not.toBeNull();
    expect(store().settings.catalogue_version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Backup has no backend yet: nothing in the desktop app claims one exists.
    expect(store().settings.last_backup_at).toBeNull();

    // Health > Support bundle: a real zip of the log folder where the save dialog said.
    const zip = path.join(data, "support.zip");
    io.nextSave.push(zip);
    const bundle = await ui.api.system.supportBundle();
    expect(bundle).toEqual({ ok: true, file_name: "support.zip", path: zip });
    expect(existsSync(zip)).toBe(true);
    expect(await ui.api.system.supportBundle()).toEqual({ ok: false, cancelled: true, error: "" }); // cancelled
    await ui.api.settings.update({ update_check: true });
  });

  it("projects: create, rename, archive, reclassify (lowering makes a reviewed copy)", async () => {
    const created = await ui.api.projects.create({ name: "Supplier FAQ", classification: "internal" });
    expect(created?.classification).toBe("internal");
    projectId = created!.id;
    expect(store().projects.some((p) => p.id === projectId)).toBe(true);

    ui.api.projects.rename(projectId, "Supplier answers");
    await eventually(() => expect(store().projects.find((p) => p.id === projectId)?.name).toBe("Supplier answers"));

    ui.api.projects.archive(projectId, true);
    await eventually(() => expect(store().projects.find((p) => p.id === projectId)?.archived).toBe(true));
    ui.api.projects.archive(projectId, false);
    await eventually(() => expect(store().projects.find((p) => p.id === projectId)?.archived).toBe(false));

    const lowered = await ui.api.projects.reclassify(projectId, "public");
    expect(lowered?.reviewedCopy).toBe(true);
    expect(lowered?.project.derived_from_project_id).toBe(projectId);
    expect(store().projects.find((p) => p.id === projectId)?.classification).toBe("internal");
  });

  it("projects: Company AI is refused while the provider flag is off", async () => {
    const before = store().toasts.length;
    ui.api.projects.setCompanyAi(projectId, true, true);
    await eventually(() => expect(store().toasts.length).toBeGreaterThan(before));
    expect(lastToast()?.description).toMatch(/company server is not available/);
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
    await eventually(() =>
      expect(store().conversations.find((c) => c.id === conversationId)?.title).toBe("Price list"),
    );

    ui.api.conversations.regenerate(conversationId);
    await eventually(() => expect(ui.api.conversations.messages(conversationId)[1]?.previous_versions).toHaveLength(1));
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

  it("evidence: the writer chains the events; export writes a signed bundle where the user chose (F-07)", async () => {
    expect(ui.api.projects.evidence(projectId).length).toBeGreaterThan(0);
    // Cancelling the save dialog writes nothing.
    await expect(ui.api.projects.exportEvidence({ project_id: projectId })).rejects.toThrow(/No file was chosen/);

    const file = path.join(data, "evidence.zip");
    io.nextSave.push(file);
    const result = await ui.api.projects.exportEvidence({ project_id: projectId });
    expect(result?.path).toBe(file);
    expect(existsSync(file)).toBe(true);
    expect(result?.custody).toBe("self-custodied Local, no anchor");
    expect(result?.expected_tip).toMatch(/^[0-9a-f]{64}$/);
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
    await ui.api.models.importOffline("minicpm5-2b-q4_k_m-openbmb-gguf");
    await eventually(() => expect(lastToast()?.title).toBe("AI model not installed"));
    expect(lastToast()?.description).toMatch(/size is different/);
    expect(store().installedModels).toEqual([]);

    ui.api.models.download("minicpm5-2b-q4_k_m-openbmb-gguf");
    await eventually(() => expect(lastToast()?.description).toMatch(/isn't available in this build yet/));
  });

  it("my secure knowledge: files and a folder from the dialogs are copied in, read and used in a question", async () => {
    const { useExtras } = await import("../src/lib/extras");
    const docs = () => useExtras.getState().knowledge;
    expect(docs()).toEqual([]);
    const folder = path.join(data, "Client contracts");
    mkdirSync(folder);
    writeFileSync(path.join(folder, "notes.txt"), "The rent review is in March.");
    writeFileSync(path.join(folder, "photo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    io.nextOpen.push(path.join(folder, "notes.txt"));
    await ui.api.knowledge.addFiles();
    expect(docs().map((d) => [d.name, d.status, d.collection])).toEqual([["notes.txt", "ready", "Added one by one"]]);

    io.nextOpen.push(folder);
    const preview = await ui.api.knowledge.chooseFolder();
    expect(preview?.files.find((f) => f.name === "notes.txt")?.already).toBe(true); // shown before anything is added
    expect(preview?.files.find((f) => f.name === "photo.png")?.problem).toMatch(/picture/);
    await ui.api.knowledge.addFolder(preview!);
    const picture = docs().find((d) => d.name === "photo.png");
    expect(picture).toMatchObject({ status: "failed", collection: "Client contracts" });
    expect(picture?.problem).toMatch(/picture/);
    expect(docs().filter((d) => d.name === "notes.txt")).toHaveLength(1); // the same file keeps one copy
    expect(store().events.filter((e) => e.event_type === "knowledge_added")).toHaveLength(2);

    const notes = docs().find((d) => d.name === "notes.txt")!;
    expect(await ui.api.conversations.send(conversationId, "When is the rent review?", [notes.id])).toEqual({ ok: true });

    await ui.api.knowledge.remove(picture!.id);
    expect(docs().some((d) => d.id === picture!.id)).toBe(false);
    expect(existsSync(path.join(folder, "photo.png"))).toBe(true); // the original is never touched
  });

  it("skills: add a listed skill, switch it off, add one from a file, remove", async () => {
    const { useExtras } = await import("../src/lib/extras");
    const x = () => useExtras.getState();
    expect(x().skillCatalogue.filter((s) => s.included).map((s) => s.id)).toEqual(["write", "read-documents"]);
    expect(x().installedSkills).toEqual([]);

    await ui.api.skills.install("minutes");
    expect(x().installedSkills.map((s) => [s.id, s.enabled])).toEqual([["minutes", true]]);
    await ui.api.skills.setEnabled("minutes", false);
    expect(x().installedSkills[0]?.enabled).toBe(false);

    const file = path.join(data, "invoice-reader.aios-skill");
    writeFileSync(file, JSON.stringify({ name: "Invoice reader", line: "Pull totals out of invoices.", category: "Documents", instruction: "List the totals." }));
    io.nextOpen.push(file);
    const chosen = await ui.api.skills.chooseFile();
    expect(chosen).toBe(file);
    const check = await ui.api.skills.checkFile(file);
    expect(check?.entry).toMatchObject({ name: "Invoice reader", publisher: "Added by you", own: true });
    expect(x().installedSkills).toHaveLength(1); // the check adds nothing
    await ui.api.skills.installFile(file);
    expect(x().skillCatalogue.some((s) => s.id === "own-invoice-reader" && s.own)).toBe(true);

    await ui.api.skills.remove("minutes");
    expect(x().installedSkills.map((s) => s.id)).toEqual(["own-invoice-reader"]);
    expect(store().events.filter((e) => e.event_type === "skill_installed")).toHaveLength(2);
  });

  it("a new recovery key: shown once, nine groups, recorded without the key (D4)", async () => {
    const key = await ui.api.recoveryKey.createNew();
    expect(key).toMatch(/^([0-9A-Z]{4}-){8}[0-9A-Z]{4}$/);
    expect(store().settings.recovery_key_issued_at).not.toBeNull();
    expect(JSON.stringify(store().events)).not.toContain(key!.replace(/-/g, ""));
  });

  it("backup: the folder chosen in the dialog gets a backup that restore accepts (D3)", async () => {
    expect(await ui.api.backup.run()).toEqual({ ok: false, error: "Choose where backups go first." });
    const usb = path.join(data, "usb");
    mkdirSync(usb);
    io.nextOpen.push(usb);
    await ui.api.backup.chooseLocation();
    expect(store().settings.backup_location).toBe(usb);

    const done = await ui.api.backup.run();
    expect(done).toMatchObject({ ok: true });
    if (!done.ok) return;
    expect(path.dirname(done.result.path)).toBe(usb);
    for (const name of ["chats.db", "recovery.pkg"]) expect(existsSync(path.join(done.result.path, name))).toBe(true);
    expect(store().settings.last_backup_at).not.toBeNull();
    expect(store().settings.last_backup_size).toBe(done.result.size_bytes);
    // Shown in Activity as the design's "Backed up your AIOS" (an export of kind backup).
    expect(store().events.some((e) => e.event_type === "export" && e.payload?.kind === "backup")).toBe(true);
  });

  it("deleting a conversation and a project removes them everywhere", async () => {
    ui.api.conversations.remove(conversationId);
    await eventually(() => expect(store().conversations.some((c) => c.id === conversationId)).toBe(false));
    expect(ui.api.conversations.messages(conversationId)).toEqual([]);

    ui.api.projects.remove(projectId);
    await eventually(() => expect(store().projects.some((p) => p.id === projectId)).toBe(false));
    await eventually(() =>
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
