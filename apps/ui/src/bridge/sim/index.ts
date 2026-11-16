/**
 * Browser preview only (`pnpm dev:ui`): a simulated backend behind the same `AiosBridge` interface as
 * the desktop app's `window.aios`. The screens, `@/lib/api` and `@/bridge/live` run unchanged; only
 * the data source differs. Everything here is sample data from the design handover, kept in memory
 * (a reload starts again). It is never used when `window.aios` exists, so the desktop app only ever
 * shows what the real backend holds.
 */
import type {
  AiosBridge,
  CatalogueEntry as LiveCatalogueEntry,
  Conversation as LiveConversation,
  DownloadState as LiveDownload,
  EvidenceEvent as LiveEvent,
  InstalledModel as LiveModel,
  Message as LiveMessage,
  Project as LiveProject,
  Settings as LiveSettings,
} from "@aios/bridge-contract";
import type { Conversation, EvidenceEvent, Message, Project } from "@/lib/types";
import { pickAnswer } from "./answers";
import { SIM_CATALOGUE, SIM_HARDWARE } from "./catalogue";
import {
  SEED_CONVERSATIONS,
  SEED_DEFAULT_PROJECT_ID,
  SEED_EVENTS,
  SEED_INSTALLED_MODELS,
  SEED_MESSAGES,
  SEED_PROJECTS,
  SEED_STREAM,
} from "./seed";

const APP_VERSION = "0.1.0";
const CATALOGUE_VERSION = "2026-11-12";
/** A message longer than this is refused as too large for the model, as the backend does. */
const MAX_MESSAGE_CHARS = 60_000;

const now = () => new Date().toISOString();
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
let counter = 0;
const newId = () => {
  counter += 1;
  const hex = (Date.now().toString(16) + counter.toString(16).padStart(6, "0")).padStart(32, "0").slice(-32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};
const fail = (code: string): never => {
  throw new Error(code);
};

/* ------------------------------------------------------------------ conversion */
const toProject = (p: Project): LiveProject => ({ ...p, derived_from_project_id: p.derived_from_project_id ?? null });
const toConversation = (c: Conversation): LiveConversation => ({
  ...c,
  last_message_preview: c.last_message_preview ?? null,
  moves: c.moves ?? [],
});
const toMessage = (m: Message): LiveMessage => ({
  id: m.id,
  conversation_id: m.conversation_id,
  role: m.role,
  content: m.content,
  classification_effective: m.classification_effective,
  classification_source: m.classification_source,
  status: m.status === "complete" || m.status === "partial" || m.status === "error" || m.status === "stopped" ? m.status : "complete",
  provider: m.provider,
  model_id: m.model_id,
  prompt_tokens: m.prompt_tokens,
  completion_tokens: m.completion_tokens,
  created_at: m.created_at,
  evidence_pending: m.evidence_pending ?? false,
  evidence_seq: m.evidence_seq ?? null,
  previous_versions: m.previous_versions ?? [],
  continued_from: m.continued_from ?? null,
});
const toEvent = (e: EvidenceEvent): LiveEvent => ({
  id: e.seq,
  event_id: `${e.stream_id}-${e.seq}`,
  event_type: e.event_type,
  actor: e.actor,
  ts: e.ts,
  project_id: e.project_id ?? null,
  conversation_id: e.conversation_id ?? null,
  payload: {
    ...(e.payload ?? {}),
    ...(e.provider ? { provider: e.provider } : {}),
    ...(e.model_digest ? { model_digest: e.model_digest } : {}),
  },
  seq: e.seq,
  pending: e.pending ?? false,
});
const toCatalogueEntry = (e: (typeof SIM_CATALOGUE)[number]): LiveCatalogueEntry => ({
  ...e,
  deviation_approval: e.deviation_approval ?? null,
});

/* ------------------------------------------------------------------ state */
const state = {
  firstRunComplete: true,
  projects: SEED_PROJECTS.map(toProject),
  conversations: SEED_CONVERSATIONS.map(toConversation),
  messages: SEED_MESSAGES.map(toMessage),
  events: SEED_EVENTS.map(toEvent),
  models: SEED_INSTALLED_MODELS.map((m) => ({ ...m })) as LiveModel[],
  downloads: new Map<string, LiveDownload>(),
  settings: {
    update_check: true,
    catalogue_check: true,
    safe_mode_cpu: false,
    default_model_id: SEED_INSTALLED_MODELS[0]?.id ?? null,
    last_update_check: new Date(Date.now() - 3 * 3_600_000).toISOString(),
    last_catalogue_check: null,
    update_available: null,
    app_version: APP_VERSION,
    catalogue_version: CATALOGUE_VERSION,
    schema_version: 4,
  } as LiveSettings,
};

function record(event_type: string, fields: { project_id?: string | null; conversation_id?: string | null; actor?: LiveEvent["actor"]; payload?: LiveEvent["payload"] } = {}): number {
  const seq = (state.events.at(-1)?.seq ?? 0) + 1;
  state.events.push({
    id: seq,
    event_id: newId(),
    event_type,
    actor: fields.actor ?? "user",
    ts: now(),
    project_id: fields.project_id ?? null,
    conversation_id: fields.conversation_id ?? null,
    payload: fields.payload ?? {},
    seq,
    pending: false,
  });
  return seq;
}

const project = (id: string) => state.projects.find((p) => p.id === id) ?? fail("project_not_found");
const conversation = (id: string) => state.conversations.find((c) => c.id === id) ?? fail("conversation_not_found");
const touch = <T extends { updated_at: string }>(x: T): T => Object.assign(x, { updated_at: now() });

function answer(conv: LiveConversation, prompt: string, regenerate: boolean): LiveMessage {
  const content = pickAnswer(prompt);
  const msg: LiveMessage = {
    id: newId(),
    conversation_id: conv.id,
    role: "assistant",
    content,
    classification_effective: conv.classification_effective,
    classification_source: conv.classification_source,
    status: "complete",
    provider: conv.current_provider,
    model_id: conv.model_id,
    prompt_tokens: Math.ceil(prompt.length / 4),
    completion_tokens: Math.ceil(content.length / 4),
    created_at: now(),
    evidence_pending: false,
    evidence_seq: null,
    previous_versions: [],
    continued_from: null,
  };
  msg.evidence_seq = record("request", { project_id: conv.project_id, conversation_id: conv.id, payload: { status: "complete", provider: conv.current_provider, ...(regenerate ? { regenerate: true } : {}) } });
  conv.last_message_preview = content.slice(0, 140);
  touch(conv);
  return msg;
}

/* ------------------------------------------------------------------ downloads */
function runDownload(entryId: string): void {
  const timer = setInterval(() => {
    const d = state.downloads.get(entryId);
    if (!d || d.status !== "downloading") return clearInterval(timer);
    d.received_bytes = Math.min(d.total_bytes, d.received_bytes + d.speed_bps / 4);
    if (d.received_bytes < d.total_bytes) return;
    clearInterval(timer);
    d.status = "verifying";
    d.speed_bps = 0;
    setTimeout(() => {
      const entry = SIM_CATALOGUE.find((e) => e.entry_id === entryId)!;
      state.models.push({ id: entry.entry_id, catalogue_entry_id: entry.entry_id, name: entry.name, file_path: `%LOCALAPPDATA%\\AIOS\\models\\${entry.file_name}`, artifact_digest: entry.artifact_digest, size_bytes: entry.size_bytes, context_length: entry.context_length, licence: entry.licence, tier: entry.tier, installed_at: now(), source: "download" });
      d.status = "done";
      record("model_installed", { actor: "app", payload: { model_id: entry.entry_id, model_digest: entry.artifact_digest, size_bytes: entry.size_bytes } });
    }, 2600);
  }, 250);
}

/* ------------------------------------------------------------------ the bridge */
export const simBridge: AiosBridge = {
  system: {
    health: async () => ({
      backend: "ok",
      database: "ok",
      engine: "not_started",
      engine_build: null,
      engine_model: null,
      engine_cpu_fallback: false,
      engine_idle_unloaded: false,
      evidence_writer: "ok",
      version: APP_VERSION,
    }),
    status: async () => ({
      backend: "ok",
      database: "ok",
      version: APP_VERSION,
      engine: { state: "not_started", build: null, loaded_model_id: null },
      writer: { state: "ok", pending: 0 },
      company: { enabled: false, reachable: false, base_url: null, model_name: null },
      generating_conversation_id: null,
    }),
    info: async () => ({
      app_version: APP_VERSION,
      profile: "dev",
      schema_version: 4,
      data_paths: { root: "%LOCALAPPDATA%\\AIOS", chats_db: "data\\chats.db", recovery_package: "data\\recovery.pkg", models: "models", logs: "logs", backups: "backups" },
      licences: [
        { name: "llama.cpp", role: "Runs the AI model", licence: "MIT" },
        ...SIM_CATALOGUE.map((e) => ({ name: e.name, role: "AI model", licence: e.licence })),
        { name: "SQLCipher", role: "Encrypts your conversations", licence: "BSD-style" },
        { name: "Electron", role: "The application window", licence: "MIT" },
      ],
    }),
    supportBundle: async () => {
      await wait(900);
      return { file_name: "AIOS diagnostic file.zip", path: "Documents\\AIOS diagnostic file.zip", size_bytes: 48_213, file_count: 3, created_at: now() };
    },
    openLink: async (url) => {
      window.open(url, "_blank", "noopener,noreferrer");
      return true;
    },
  },

  setup: {
    status: async () => ({
      first_run_complete: state.firstRunComplete,
      store_created: true,
      stream_id: SEED_STREAM.stream_id,
      signing_key_id: SEED_STREAM.signer_key_id,
      package_id: null,
      default_project_id: SEED_DEFAULT_PROJECT_ID,
      completed_at: null,
      last_restore_at: null,
      recovery_package_present: true,
    }),
    createStore: async () => {
      const key = Array.from({ length: 9 }, () => Math.random().toString(36).slice(2, 6).toUpperCase().padEnd(4, "X")).join("-");
      record("recovery_key_issued", { actor: "app" });
      return { recovery_key: key, package_id: newId(), stream_id: SEED_STREAM.stream_id, signing_key_id: SEED_STREAM.signer_key_id };
    },
    complete: async () => {
      state.firstRunComplete = true;
      return { default_project_id: SEED_DEFAULT_PROJECT_ID };
    },
    chooseBackupFolder: async () => ({ path: "E:\\AIOS backups\\AIOS backup 2026-11-08", has_recovery_package: true, has_database: true }),
    restore: async (input) => {
      await wait(3600);
      if (input.recovery_key.replace(/-/g, "").length !== 36) fail("r_checksum");
      record("restore", { actor: "app" });
      return { stream_id: SEED_STREAM.stream_id, epoch: 2 };
    },
  },

  settings: {
    get: async () => ({ ...state.settings }),
    update: async (patch) => Object.assign(state.settings, patch) && { ...state.settings },
    network: async () => [
      { id: "model-origin", host: "huggingface.co", port: 443, purpose: "AI models you install, downloaded directly from their publisher", kind: "fixed", enabled: true },
      { id: "update-feed", host: "updates.example.eu", port: 443, purpose: "Signed update feed (at start, at most once a day)", kind: "fixed", enabled: true },
      { id: "company-server", host: "ai.internal.example.com", port: 443, purpose: "Company AI server (configured by an operator)", kind: "configured", enabled: false },
    ],
    checkForUpdates: async () => {
      await wait(1400);
      state.settings.last_update_check = now();
      return { ...state.settings };
    },
    checkCatalogue: async () => {
      state.settings.last_catalogue_check = now();
      return { version: CATALOGUE_VERSION, changed: false, checked_at: now() };
    },
  },

  projects: {
    list: async () => state.projects.map((p) => ({ ...p })),
    create: async (input) => {
      const p: LiveProject = { id: newId(), name: input.name, classification: input.classification, classification_source: "project", derived_from_project_id: null, company_ai_enabled: false, archived: false, created_at: now(), updated_at: now() };
      state.projects.unshift(p);
      record("project_created", { project_id: p.id });
      return { ...p };
    },
    update: async (id, patch) => ({ ...touch(Object.assign(project(id), patch)) }),
    remove: async (id) => {
      project(id);
      const convs = state.conversations.filter((c) => c.project_id === id).map((c) => c.id);
      state.projects = state.projects.filter((p) => p.id !== id);
      state.conversations = state.conversations.filter((c) => c.project_id !== id);
      state.messages = state.messages.filter((m) => !convs.includes(m.conversation_id));
      record("project_deleted", { payload: { conversations: convs.length } });
    },
    reclassify: async (id, to) => {
      const p = project(id);
      const order = { restricted: 0, internal: 1, public: 2 };
      if (order[to] > order[p.classification]) {
        const copy: LiveProject = { ...p, id: newId(), name: `${p.name} (${to[0]!.toUpperCase()}${to.slice(1)} copy)`, classification: to, classification_source: "review", derived_from_project_id: p.id, created_at: now(), updated_at: now() };
        state.projects.unshift(copy);
        record("project_reclassified", { project_id: copy.id, payload: { to_class: to, reviewed_copy: true } });
        return { project: { ...copy }, reviewed_copy: true };
      }
      touch(Object.assign(p, { classification: to }));
      record("project_reclassified", { project_id: p.id, payload: { to_class: to } });
      return { project: { ...p }, reviewed_copy: false };
    },
    setCompanyAi: async () => fail("company_provider_disabled"),
    exportPackage: async (id, input) => {
      project(id);
      await wait(1200);
      const seq = record("project_exported", { project_id: id });
      return { file_name: input.file_name, path: `Documents\\${input.file_name}`, size_bytes: 86 * 1024, checksum: "9f2d7c1e4b6a8d0f3e5c7a9b1d3f5e7c9a1b3d5f7e9c1a3b5d7f9e1c3a5b7d9f", package_id: newId(), evidence_seq: seq };
    },
    choosePackage: async () => ({ path: "Documents\\supplier-faq.aiosproj", file_name: "supplier-faq.aiosproj", size_bytes: 86 * 1024 }),
    importPackage: async () => {
      await wait(1400);
      const p: LiveProject = { id: newId(), name: "Supplier FAQ", classification: "internal", classification_source: "import", derived_from_project_id: null, company_ai_enabled: false, archived: false, created_at: now(), updated_at: now() };
      state.projects.unshift(p);
      record("project_imported", { project_id: p.id });
      return { project_id: p.id, project_name: p.name, conversations: 0, messages: 0, summaries: 0, warnings: [], remapped: true };
    },
  },

  conversations: {
    list: async (projectId) => state.conversations.filter((c) => c.project_id === projectId).map((c) => ({ ...c })),
    create: async (projectId, title) => {
      const p = project(projectId);
      const c: LiveConversation = { id: newId(), project_id: p.id, title: title ?? "New conversation", classification_effective: p.classification, classification_source: "project", provider_mode: "local", current_provider: "local", model_id: state.settings.default_model_id, archived: false, created_at: now(), updated_at: now(), last_message_preview: null, moves: [] };
      state.conversations.push(c);
      record("conversation_created", { project_id: p.id, conversation_id: c.id });
      return { ...c };
    },
    update: async (id, patch) => ({ ...touch(Object.assign(conversation(id), patch)) }),
    remove: async (id) => {
      const c = conversation(id);
      state.conversations = state.conversations.filter((x) => x.id !== id);
      state.messages = state.messages.filter((m) => m.conversation_id !== id);
      record("conversation_deleted", { project_id: c.project_id });
    },
    setProvider: async () => fail("company_provider_disabled"),
    messages: async (id) => state.messages.filter((m) => m.conversation_id === id).map((m) => ({ ...m })),
    send: async (id, text) => {
      const c = conversation(id);
      if (!text.trim()) fail("empty_message");
      if (text.length > MAX_MESSAGE_CHARS) {
        record("refusal", { actor: "app", project_id: c.project_id, conversation_id: c.id });
        fail("message_too_large");
      }
      if (!state.models.length) fail("no_model");
      const user: LiveMessage = { ...answer(c, text, false), id: newId(), role: "user", content: text, completion_tokens: 0 };
      state.messages.push(user);
      await wait(900); // an answer takes a moment
      const reply = answer(c, text, false);
      state.messages.push(reply);
      return { user, assistant: reply };
    },
    regenerate: async (id) => {
      const c = conversation(id);
      const msgs = state.messages.filter((m) => m.conversation_id === id);
      const last = msgs.at(-1);
      const prompt = [...msgs].reverse().find((m) => m.role === "user");
      if (!last || last.role !== "assistant" || !prompt) fail("nothing_to_regenerate");
      await wait(900);
      const reply = answer(c, prompt!.content, true);
      Object.assign(last!, { content: reply.content, previous_versions: [...last!.previous_versions, last!.content], created_at: reply.created_at });
      return { user: null, assistant: { ...last! } };
    },
    providers: async () => ({ local_ready: state.models.length > 0, company_enabled: false }),
  },

  search: {
    query: async (q) => {
      const needle = q.trim().toLowerCase();
      if (needle.length < 2) return [];
      return state.messages
        .filter((m) => m.content.toLowerCase().includes(needle))
        .map((m) => {
          const c = state.conversations.find((x) => x.id === m.conversation_id);
          const at = m.content.toLowerCase().indexOf(needle);
          return { message_id: m.id, conversation_id: m.conversation_id, project_id: c?.project_id ?? "", snippet: m.content.slice(Math.max(0, at - 60), at + needle.length + 80), created_at: m.created_at, role: m.role };
        })
        .reverse();
    },
  },

  evidence: {
    list: async (projectId) => state.events.filter((e) => !projectId || e.project_id === projectId).map((e) => ({ ...e })),
    status: async () => ({ writer: "ok", pending: 0 }),
    stream: async () => ({ stream_id: SEED_STREAM.stream_id, device_id: SEED_STREAM.device_id, epoch: SEED_STREAM.epoch, signer_key_id: SEED_STREAM.signer_key_id, prior_tip_hash: SEED_STREAM.prior_tip_hash ?? null, created_at: SEED_STREAM.created_at }),
    export: async (input) => {
      await wait(1600);
      const seqs = state.events.filter((e) => input.scope !== "project" || e.project_id === input.project_id).map((e) => e.seq ?? 0);
      return { file_name: "AIOS activity record.zip", path: "Documents\\AIOS activity record.zip", size_bytes: 24_576, stream_id: SEED_STREAM.stream_id, epoch_range: [1, 1], first_seq: Math.min(...seqs, 1), last_seq: Math.max(...seqs, 1), expected_tip: "4c1f6a9e2b7d3e8f0a5c6b1d9e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f", signer_key_ids: [SEED_STREAM.signer_key_id], checkpoint_ids: [], custody: "self-custodied Local, no anchor", exported_at: now(), scope: input.scope };
    },
  },

  models: {
    catalogue: async () => ({ version: CATALOGUE_VERSION, signed: false, entries: SIM_CATALOGUE.map(toCatalogueEntry) }),
    installed: async () => state.models.map((m) => ({ ...m })),
    chooseFile: async () => null,
    importFile: async () => fail("file_not_readable"),
    download: async (entryId) => {
      const entry = SIM_CATALOGUE.find((e) => e.entry_id === entryId) ?? fail("catalogue_entry_not_found");
      if (state.models.some((m) => m.id === entryId)) fail("model_installed");
      state.downloads.set(entryId, { entry_id: entryId, status: "downloading", received_bytes: 0, total_bytes: entry.size_bytes, speed_bps: 105_000_000, error: null, started_at: now() });
      runDownload(entryId);
    },
    downloads: async () => {
      const list = [...state.downloads.values()].map((d) => ({ ...d }));
      for (const [id, d] of state.downloads) if (d.status === "done") state.downloads.delete(id);
      return list;
    },
    pauseDownload: async (entryId) => {
      const d = state.downloads.get(entryId) ?? fail("download_not_found");
      Object.assign(d, { status: "paused", speed_bps: 0 });
      return { ...d };
    },
    resumeDownload: async (entryId) => {
      const d = state.downloads.get(entryId) ?? fail("download_not_found");
      Object.assign(d, { status: "downloading", speed_bps: 105_000_000, error: null });
      runDownload(entryId);
      return { ...d };
    },
    cancelDownload: async (entryId) => {
      state.downloads.delete(entryId);
    },
    remove: async (id) => {
      const m = state.models.find((x) => x.id === id) ?? fail("model_not_found");
      state.models = state.models.filter((x) => x.id !== id);
      if (state.settings.default_model_id === id) state.settings.default_model_id = state.models[0]?.id ?? null;
      record("model_deleted", { actor: "user", payload: { model_id: m.id, model_digest: m.artifact_digest } });
    },
    hardware: async () => ({ ...SIM_HARDWARE, gpu: SIM_HARDWARE.gpu ?? null, recommended_entry_id: SIM_HARDWARE.recommended_entry_id ?? null, checked_at: now(), benchmark: SIM_HARDWARE.benchmark ?? null }),
    engine: async () => ({ state: state.models.length ? "not_started" : "no_model", installed: state.models.length, build: null, loaded_model_id: null }),
    benchmark: async () => {
      await wait(2600);
      const run = { model_id: state.settings.default_model_id ?? "", engine: "vulkan" as const, tokens_per_second: 36 + Math.random(), time_to_first_token_ms: 450, run_at: now() };
      SIM_HARDWARE.benchmark = run;
      return run;
    },
  },

  spike: {
    ask: async () => ({ text: "", error: "backend_unavailable", firstTokenMs: null, totalMs: 0, tokens: null, tokensPerSecond: null }),
  },
};
