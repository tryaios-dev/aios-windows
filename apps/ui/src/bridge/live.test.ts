import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiosBridge, Exchange, Health, InstalledModel, Settings, SetupStatus } from "@aios/bridge-contract";
import { api } from "./api";
import { hydrate, refreshHealth } from "./live";
import { useStore } from "./sim/store";

const STATUS: SetupStatus = {
  first_run_complete: false,
  store_created: false,
  stream_id: null,
  signing_key_id: null,
  package_id: null,
  default_project_id: null,
  completed_at: null,
  last_restore_at: null,
  recovery_package_present: false,
};

const SETTINGS: Settings = {
  update_check: true,
  catalogue_check: true,
  safe_mode_cpu: false,
  default_model_id: null,
  last_update_check: null,
  last_catalogue_check: null,
  update_available: null,
  app_version: "0.1.0",
  catalogue_version: null,
  schema_version: 3,
};

const PROVIDERS = { local_ready: false, company_enabled: false };
const EVIDENCE = { writer: "unavailable" as const, pending: 0 };
const HARDWARE = {
  cpu: "Test CPU",
  cores: 8,
  ram_gb: 16,
  gpu: null,
  free_disk_gb: 200,
  os: "Windows 11",
  recommended_tier: "medium" as const,
  checked_at: "2026-11-05T10:00:00Z",
};

const HEALTH: Health = {
  backend: "ok",
  database: "ok",
  engine: "not_started",
  engine_build: null,
  engine_model: null,
  engine_cpu_fallback: false,
  engine_idle_unloaded: false,
  evidence_writer: "not_started",
  version: "0.1.0",
};

const MODEL: InstalledModel = {
  id: "inst-1",
  catalogue_entry_id: "qwen3-4b-q4km",
  name: "Qwen3 4B",
  file_path: "C:\\Users\\a\\AppData\\Local\\AIOS\\models\\Qwen3-4B-Q4_K_M.gguf",
  artifact_digest: "7485fe6f",
  size_bytes: 2497280256,
  context_length: 32768,
  licence: "Apache-2.0",
  tier: "small",
  installed_at: "2026-11-06T10:00:00Z",
  source: "offline",
};

/** Methods this unit test does not call. */
const unused = <T>() => ({}) as T;

/** A fake window.aios, as preload would expose it. Errors look like Electron's wrapped ones. */
function fakeBridge() {
  const remote = (code: string) => new Error(`Error invoking remote method 'aios:invoke': Error: ${code}`);
  const state = { status: { ...STATUS }, settings: { ...SETTINGS }, health: { ...HEALTH } };
  const bridge: AiosBridge = {
    system: { health: vi.fn(async () => state.health) },
    setup: {
      status: vi.fn(async () => state.status),
      createStore: vi.fn(async () => {
        if (state.status.store_created) throw remote("store_exists");
        state.status = { ...state.status, store_created: true, stream_id: "stream-1", signing_key_id: "key-1" };
        return {
          recovery_key: "AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH-JJJJ",
          package_id: "p",
          stream_id: "stream-1",
          signing_key_id: "key-1",
        };
      }),
      complete: vi.fn(async () => {
        state.status = { ...state.status, first_run_complete: true, default_project_id: "proj-1" };
        return { default_project_id: "proj-1" };
      }),
      chooseBackupFolder: vi.fn(async () => null),
      restore: vi.fn(async () => {
        throw remote("r_unwrap");
      }),
    },
    settings: {
      get: vi.fn(async () => state.settings),
      update: vi.fn(async (patch) => (state.settings = { ...state.settings, ...patch })),
      network: vi.fn(async () => [
        {
          id: "model-mirror",
          host: "models.example.eu",
          port: 443,
          purpose: "Model mirror",
          kind: "fixed" as const,
          enabled: true,
        },
      ]),
      checkForUpdates: vi.fn(
        async () => (state.settings = { ...state.settings, last_update_check: "2026-11-05T10:00:00Z" }),
      ),
    },
    // An empty workspace: the full stack is covered by e2e/fullStack.e2e.ts.
    projects: { ...unused(), list: vi.fn(async () => []) },
    conversations: {
      ...unused(),
      list: vi.fn(async () => []),
      providers: vi.fn(async () => PROVIDERS),
      send: vi.fn(async () => ({}) as Exchange),
      messages: vi.fn(async () => []),
    },
    search: unused(),
    evidence: { ...unused(), list: vi.fn(async () => []), status: vi.fn(async () => EVIDENCE) },
    models: {
      ...unused(),
      installed: vi.fn(async () => []),
      hardware: vi.fn(async () => HARDWARE),
    },
    spike: unused(), // SPIKE-D04
  } as AiosBridge;
  return { bridge, state };
}

let fake: ReturnType<typeof fakeBridge>;

beforeEach(() => {
  useStore.getState().resetFirstRun("fresh");
  fake = fakeBridge();
  window.aios = fake.bridge;
});
afterEach(() => {
  delete window.aios;
});

describe("desktop app: setup and settings come from the backend", () => {
  it("loads first-run state, settings and the allowlist before the first render", async () => {
    fake.state.status = { ...STATUS, first_run_complete: true, stream_id: "stream-9", signing_key_id: "key-9" };
    fake.state.settings = { ...SETTINGS, safe_mode_cpu: true, default_model_id: "qwen3-4b-q4km" };
    await hydrate();
    const s = useStore.getState();
    expect(s.ui.firstRunComplete).toBe(true);
    expect(s.stream.stream_id).toBe("stream-9");
    expect(s.settings.safe_mode_cpu).toBe(true);
    expect(s.settings.default_model_id).toBe("qwen3-4b-q4km");
    expect(s.liveAllowlist?.map((e) => e.host)).toEqual(["models.example.eu"]);
  });

  it("saves a changed setting in the backend and shows what it stored", async () => {
    await api.settings.update({ update_check: false });
    expect(fake.bridge.settings.update).toHaveBeenCalledWith({ update_check: false });
    expect(useStore.getState().settings.update_check).toBe(false);
  });

  it("issues the recovery key once; a second store is refused", async () => {
    const first = await api.firstRun.issueRecoveryKey();
    expect(first).toEqual({ ok: true, key: "AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH-JJJJ" });
    expect(useStore.getState().recoveryKey).toBe(first.ok && first.key);
    const second = await api.firstRun.issueRecoveryKey();
    expect(second.ok).toBe(false);
    expect(!second.ok && second.alreadyIssued).toBe(true);
  });

  it("finishes first run in the backend before opening the app", async () => {
    await api.firstRun.issueRecoveryKey();
    expect(await api.firstRun.complete({ installedModelId: null })).toBe(true);
    expect(fake.bridge.setup.complete).toHaveBeenCalledOnce();
    expect(useStore.getState().ui.firstRunComplete).toBe(true);
  });

  it("explains a failed restore in plain words", async () => {
    const r = await api.restore({ backup_path: "D:\\backup", recovery_key: "x", has_package: true });
    expect(r).toEqual({ ok: false, error: expect.stringContaining("doesn't match this Recovery Package") });
    expect(api.backup.keyLength()).toBe(36);
  });
});

describe("desktop app: engine state comes from the backend's /health (D-06)", () => {
  const ready = async (health: Partial<Health>) => {
    fake.state.status = { ...STATUS, first_run_complete: true };
    fake.state.health = { ...HEALTH, ...health };
    await hydrate();
  };

  it("shows the real engine state, build and loaded model", async () => {
    vi.mocked(fake.bridge.models.installed).mockResolvedValue([MODEL]);
    await ready({ engine: "ok", engine_build: "vulkan", engine_model: "Qwen3-4B-Q4_K_M.gguf" });
    const h = useStore.getState().health;
    expect(h.engine).toBe("ready");
    expect(h.engine_build).toBe("vulkan");
    expect(h.loaded_model_id).toBe("inst-1");
  });

  it("maps starting, idle unload and failure", async () => {
    vi.mocked(fake.bridge.models.installed).mockResolvedValue([MODEL]);
    await ready({ engine: "starting", engine_build: "cpu" });
    expect(useStore.getState().health.engine).toBe("loading");
    fake.state.health = { ...HEALTH, engine_idle_unloaded: true };
    await refreshHealth();
    expect(useStore.getState().health.engine).toBe("idle_unloaded");
    fake.state.health = { ...HEALTH, engine: "failed" };
    await refreshHealth();
    expect(useStore.getState().health.engine).toBe("failed");
  });

  it("raises the shared fallback notice when the backend fell back to CPU", async () => {
    await ready({ engine: "ok", engine_build: "cpu", engine_cpu_fallback: true });
    expect(useStore.getState().fallbackNotice).toEqual({ at: expect.any(String), dismissed: false });
    expect(useStore.getState().health.engine_build).toBe("cpu");
  });

  it("keeps a dismissed notice hidden on later polls", async () => {
    await ready({ engine: "ok", engine_build: "cpu", engine_cpu_fallback: true });
    api.system.dismissFallbackNotice();
    await refreshHealth();
    await refreshHealth();
    expect(useStore.getState().fallbackNotice?.dismissed).toBe(true);
  });

  it("checks /health right after an answer, so the notice comes with that answer", async () => {
    await ready({});
    fake.state.health = { ...HEALTH, engine: "ok", engine_build: "cpu", engine_cpu_fallback: true };
    await api.conversations.send("conv-1", "hello");
    expect(useStore.getState().fallbackNotice?.dismissed).toBe(false);
  });

  it("with Safe mode on and no engine running, shows the CPU build", async () => {
    fake.state.settings = { ...SETTINGS, safe_mode_cpu: true };
    await ready({ engine_build: null });
    expect(useStore.getState().health.engine_build).toBe("cpu");
  });
});
