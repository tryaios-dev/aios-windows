/**
 * Live data: in the desktop app, every screen's data comes from the backend through window.aios.
 *
 * The screens read the zustand store (`sim/store.ts`); this module loads the backend's data
 * into it and is called again after each change, so every screen shows what the backend holds.
 * In a plain browser (`pnpm dev:ui`) nothing here runs and the simulation stays as is.
 */
import {
  errorCode,
  type AllowlistEntry,
  type Conversation as LiveConversation,
  type EvidenceEvent as LiveEvent,
  type Hardware as LiveHardware,
  type Health as LiveHealth,
  type InstalledModel as LiveModel,
  type Message as LiveMessage,
  type Project as LiveProject,
  type Settings as LiveSettings,
  type SetupStatus,
  type SystemStatus as LiveSystemStatus,
  type EvidenceStream as LiveStream,
} from "@aios/bridge-contract";
import type {
  Conversation,
  EngineBuild,
  EngineState,
  EventType,
  EvidenceEvent,
  Hardware,
  Health,
  InstalledModel,
  Message,
  Project,
} from "@/lib/types";
import { ZERO_HASH } from "@/lib/hash";
import { bridge, inElectron } from "./index";
import { useStore } from "./sim/store";

export const isLive = inElectron;

/** Plain-language text for the backend's error codes the user can hit. */
const MESSAGES: Record<string, string> = {
  store_exists: "The store on this computer was already created; its recovery key was shown then.",
  store_not_created: "The encrypted store has not been created yet. Go back to “Secure your data”.",
  invalid_setting: "That setting cannot be empty.",
  update_check_off: "Update checks are switched off.",
  invalid_path: "That location can't be used. Choose another file or folder.",
  log_folder_missing: "There is no log folder yet, so there is nothing to put in a support bundle.",
  catalogue_check_off: "The model catalogue check is switched off.",
  catalogue_unreachable: "The model mirror can't be reached. Check the connection and try again.",
  catalogue_signature_invalid: "The model mirror answered with a catalogue that could not be verified.",
  no_recovery_package:
    "No Recovery Package was found in that folder. Choose the backup of the data folder that contains recovery.pkg.",
  no_backup_database: "That folder has no chats.db. Choose the backup of the whole data folder.",
  r_checksum: "The recovery key has a typing error. Check it character by character.",
  r_unwrap: "The recovery key doesn't match this Recovery Package. Check it character by character.",
  r_mismatch: "This recovery key belongs to a different store than the backup in that folder.",
  r_format: "recovery.pkg in that folder is damaged or not a Recovery Package.",
  r_kdf_params: "recovery.pkg in that folder uses settings this version does not accept.",
  r_payload: "recovery.pkg in that folder is damaged.",
  restore_failed: "Restoring failed and everything was put back as it was.",
  invalid_request: "The request was not valid.",
  project_not_found: "That project no longer exists.",
  conversation_not_found: "That conversation no longer exists.",
  model_not_found: "That model is not installed.",
  catalogue_entry_not_found: "That model is not in the catalogue.",
  confirmation_required: "This needs your confirmation first.",
  company_provider_disabled: "Company AI is not available on this installation.",
  no_model: "No local model is installed yet. Download the suggested model in Models.",
  model_missing: "No installed model can answer. Download the suggested model in Models.",
  company_unreachable: "The Company AI server can't be reached.",
  empty_message: "The message is empty.",
  message_too_large: "This message is too long for the model's context. Shorten it or split it up.",
  nothing_to_regenerate: "There is no answer to regenerate yet.",
  file_not_readable: "That file can't be read.",
  p_zip: "That file is not a Project Package (it is not a valid archive).",
  p_format: "That file is not a Project Package this version can read.",
  p_checksum: "The package is damaged: a checksum does not match. Nothing was imported.",
  p_reference: "The package is damaged: it refers to records it does not contain. Nothing was imported.",
  p_unlisted: "The package contains files it does not list. Nothing was imported.",
  p_missing: "The package is missing files it lists. Nothing was imported.",
  writer_unavailable:
    "The evidence writer is not part of this build yet, so the log can't be exported. Every event is kept and waits for it.",
  size_mismatch: "That file is not the model you chose: its size is different from the catalogue entry.",
  digest_mismatch: "That file does not match the catalogue: its SHA-256 is different. It was not installed.",
  deviation_not_approved:
    "That model file matches the catalogue, but its third-party review has not passed yet, so it can't be installed.",
  not_gguf: "Choose a .gguf model file.",
  model_installed: "That model is already installed.",
  mirror_unavailable:
    "Downloading isn't available in this build: the model mirror is not set up yet. Use Import instead.",
  not_in_electron: "This needs the desktop app.",
  mirror_unreachable:
    "The download stopped: Hugging Face could not be reached. What arrived is kept; resume when you are online.",
  download_incomplete: "The download ended early. What arrived is kept; resume to finish it.",
  download_exists: "This model is already downloading.",
  not_enough_disk: "Not enough free disk on the drive AIOS is installed on for this model.",
  host_not_allowed: "The download was redirected to a host AIOS does not allow, so it was stopped.",
  engine_failed: "The local engine could not answer. Try again; if it keeps failing, restart AIOS.",
};

export function messageFor(err: unknown): string {
  const code = errorCode(err);
  return MESSAGES[code] ?? `Something went wrong (${code}).`;
}

/** Show a failed call as a toast. The screen keeps its last good state. */
export function reportFailure(err: unknown, title: string): void {
  useStore.getState().toast({ kind: "deny", title, description: messageFor(err) });
}

/* ------------------------------------------------------------------ mapping */
const opt = <T>(v: T | null): T | undefined => v ?? undefined;

export const toProject = (p: LiveProject): Project => ({
  ...p,
  derived_from_project_id: opt(p.derived_from_project_id),
});

export const toConversation = (c: LiveConversation): Conversation => ({
  ...c,
  last_message_preview: opt(c.last_message_preview),
});

export function toMessages(list: LiveMessage[], conversation?: Conversation): Message[] {
  // A provider divider is drawn above the first message after each move.
  const dividers = new Map<string, NonNullable<Conversation["moves"]>[number]>();
  for (const move of conversation?.moves ?? []) {
    const first = list.find((m) => m.created_at >= move.at);
    if (first && first !== list[0]) dividers.set(first.id, move);
  }
  return list.map((m) => ({
    ...m,
    evidence_seq: opt(m.evidence_seq),
    continued_from: opt(m.continued_from),
    divider_before: dividers.get(m.id),
  }));
}

/** Backend event names that have an older name in the UI's event list. */
const EVENT_ALIASES: Record<string, EventType> = {
  inference_completed: "request",
  project_exported: "export",
  project_imported: "import",
};

export function toEvent(e: LiveEvent, streamId: string): EvidenceEvent {
  const payload = { ...e.payload };
  if (typeof payload.model_id === "string" && payload.entry_id === undefined) payload.entry_id = payload.model_id;
  const provider = payload.provider === "local" || payload.provider === "company" ? payload.provider : undefined;
  return {
    seq: e.seq ?? e.id,
    format_version: 1,
    stream_id: streamId,
    epoch: 1,
    ts: e.ts,
    event_type: EVENT_ALIASES[e.event_type] ?? (e.event_type as EventType),
    actor: e.actor,
    project_id: opt(e.project_id),
    conversation_id: opt(e.conversation_id),
    provider,
    // Hashes and signatures exist only once the evidence writer has appended the event.
    prev_hash: ZERO_HASH,
    event_hash: ZERO_HASH,
    payload,
    pending: e.pending,
  };
}

export const toModel = (m: LiveModel): InstalledModel => ({ ...m });

/** The backend's last benchmark when it reports one (null: none has run on this machine). */
export const toHardware = (h: LiveHardware, previous: Hardware): Hardware => ({
  cpu: h.cpu,
  cores: h.cores,
  ram_gb: h.ram_gb,
  ...(h.gpu ? { gpu: h.gpu } : {}),
  free_disk_gb: h.free_disk_gb,
  os: h.os,
  recommended_tier: h.recommended_tier,
  recommended_entry_id: h.recommended_entry_id ?? null,
  benchmark: h.benchmark === undefined ? previous.benchmark : (h.benchmark ?? undefined),
});

/* ------------------------------------------------------------------ apply */
/** Version of the catalogue bundled with the backend; read once (GET /models/catalogue). */
let bundledCatalogue: string | null = null;

/** Backend settings into the store. Until the mirror has been checked, the version shown is the
 * bundled catalogue's; the last check time is the backend's (null: "Never checked"). */
export function applySettings(s: LiveSettings): void {
  useStore.setState((st) => ({
    settings: {
      ...st.settings,
      ...s,
      catalogue_version: s.catalogue_version ?? bundledCatalogue ?? st.settings.catalogue_version,
      last_catalogue_check: s.last_catalogue_check,
    },
  }));
}

/** Company AI and the writer as the backend reports them (Settings > Health, project header, composer). */
export function applySystemStatus(status: LiveSystemStatus): void {
  useStore.setState((s) => ({
    health: {
      ...s.health,
      writer: status.writer.state,
      evidence_pending: status.writer.pending,
      company: {
        enabled: status.company.enabled,
        reachable: status.company.reachable,
        base_url: status.company.base_url ?? "",
        model_name: status.company.model_name ?? "",
      },
    },
  }));
}

/** The evidence stream (Settings > Data, Evidence tab). The device id comes from the evidence writer. */
export function applyStream(stream: LiveStream): void {
  useStore.setState((s) => ({
    stream: {
      stream_id: stream.stream_id,
      device_id: stream.device_id ?? "not assigned yet",
      epoch: stream.epoch,
      signer_key_id: stream.signer_key_id,
      prior_tip_hash: stream.prior_tip_hash ?? undefined,
      created_at: stream.created_at ?? s.stream.created_at,
    },
  }));
}

export function applyAllowlist(entries: AllowlistEntry[]): void {
  useStore.setState({ liveAllowlist: entries });
}

/** Setup status into the store: first-run state and the store's stream identity. */
export function applyStatus(status: SetupStatus): void {
  const st = useStore.getState();
  // The backend has no finished setup but the browser storage still holds an old workspace
  // (for example after the data folder was reset): start setup from scratch.
  if (!status.first_run_complete && st.ui.firstRunComplete) st.resetFirstRun("fresh");
  useStore.setState((s) => ({
    ui: { ...s.ui, firstRunComplete: status.first_run_complete },
    stream: {
      ...s.stream,
      stream_id: status.stream_id ?? s.stream.stream_id,
      signer_key_id: status.signing_key_id ?? s.stream.signer_key_id,
    },
  }));
}

/* ------------------------------------------------------------------ refresh */
/**
 * Two quick changes start two reloads of the same list; the older one can answer last. Each
 * reload takes a ticket, and only the newest ticket's answer is written into the store.
 */
const tickets: Record<string, number> = {};
const ticket = (key: string) => {
  const mine = (tickets[key] ?? 0) + 1;
  tickets[key] = mine;
  return () => tickets[key] === mine;
};

export async function refreshSettings(): Promise<void> {
  if (bundledCatalogue === null) {
    try {
      bundledCatalogue = (await bridge().models.catalogue()).version;
    } catch {
      // The version shown stays as it is; the settings themselves still load.
    }
  }
  const [settings, network] = await Promise.all([bridge().settings.get(), bridge().settings.network()]);
  applySettings(settings);
  applyAllowlist(network);
}

/** Company AI, writer state (GET /system/status) and build facts (GET /system/info). */
export async function refreshSystem(): Promise<void> {
  const [status, info] = await Promise.all([bridge().system.status(), bridge().system.info()]);
  applySystemStatus(status);
  useStore.setState({ liveInfo: info });
}

/** The stream exists once the store has been created; before that there is nothing to load. */
export async function refreshStream(): Promise<void> {
  applyStream(await bridge().evidence.stream());
}

export async function refreshStatus(): Promise<SetupStatus> {
  const status = await bridge().setup.status();
  applyStatus(status);
  return status;
}

export async function refreshProjects(): Promise<Project[]> {
  const newest = ticket("projects");
  const projects = (await bridge().projects.list()).map(toProject);
  if (newest()) useStore.setState({ projects });
  return projects;
}

/** All conversations of all projects (the sidebar and search list them across projects). */
export async function refreshConversations(projectIds?: string[]): Promise<void> {
  const ids = projectIds ?? useStore.getState().projects.map((p) => p.id);
  const newest = ticket(projectIds ? `conversations:${ids.join(",")}` : "conversations");
  const lists = await Promise.all(ids.map((id) => bridge().conversations.list(id)));
  if (!newest()) return;
  const fresh = lists.flat().map(toConversation);
  useStore.setState((s) => {
    // A full reload replaces the list (conversations of deleted projects go too).
    const others = projectIds ? s.conversations.filter((c) => !ids.includes(c.project_id)) : [];
    const conversations = [...others, ...fresh];
    // Messages of conversations that no longer exist go in the same update.
    const kept = new Set(conversations.map((c) => c.id));
    return { conversations, messages: s.messages.filter((m) => kept.has(m.conversation_id)) };
  });
}

export async function refreshConversation(id: string): Promise<void> {
  const conv = useStore.getState().conversations.find((c) => c.id === id);
  if (conv) await refreshConversations([conv.project_id]);
}

/** Messages of one conversation, loaded when it is opened and after each send. */
export async function loadMessages(conversationId: string): Promise<void> {
  const newest = ticket(`messages:${conversationId}`);
  const list = await bridge().conversations.messages(conversationId);
  if (!newest()) return;
  const conversation = useStore.getState().conversations.find((c) => c.id === conversationId);
  const messages = toMessages(list, conversation);
  useStore.setState((s) => ({
    messages: [...s.messages.filter((m) => m.conversation_id !== conversationId), ...messages],
  }));
}

export async function refreshEvents(): Promise<void> {
  const newest = ticket("events");
  const [events, status] = await Promise.all([bridge().evidence.list(), bridge().evidence.status()]);
  if (!newest()) return;
  const streamId = useStore.getState().stream.stream_id;
  useStore.setState((s) => ({
    events: events.map((e) => toEvent(e, streamId)).sort((a, b) => a.seq - b.seq),
    health: { ...s.health, writer: status.writer, evidence_pending: status.pending },
  }));
}

export async function refreshModels(refreshHardware = false): Promise<void> {
  const newest = ticket("models");
  const [installed, hardware, providers] = await Promise.all([
    bridge().models.installed(),
    bridge().models.hardware(refreshHardware),
    bridge().conversations.providers(),
  ]);
  if (!newest()) return;
  useStore.setState((s) => ({
    installedModels: installed.map(toModel),
    hardware: toHardware(hardware, s.hardware),
    health: {
      ...s.health,
      backend: "ok",
      company: { ...s.health.company, enabled: providers.company_enabled },
    },
  }));
}

const ENGINE_STATE: Record<LiveHealth["engine"], EngineState> = {
  not_started: "not_started",
  starting: "loading",
  ok: "ready",
  degraded: "ready",
  failed: "failed",
};

/** The build the engine ran on last in this session; null until it has run. */
let lastBuild: EngineBuild | null = null;

/** Tests only: start as if the app had just opened. */
export function resetEngineMemory(): void {
  lastBuild = null;
}

/** No engine running: the build the next start will use. CPU with Safe mode or after a fallback;
 * otherwise the build it last ran on, or the GPU build only if a graphics card with its own memory
 * and a working driver was found (a virtual display adapter has none). The backend decides for
 * real when it starts the engine. */
function nextBuild(h: LiveHealth, s: { safeMode: boolean; hardware: Hardware }): EngineBuild {
  if (s.safeMode || h.engine_cpu_fallback) return "cpu";
  if (lastBuild) return lastBuild;
  const gpu = s.hardware.gpu;
  return gpu && gpu.driver_ok && gpu.vram_gb > 0 ? "vulkan" : "cpu";
}

/** The backend's /health (process manager) as the engine state every screen shows (D-06). */
export function toEngineHealth(
  h: LiveHealth,
  s: { health: Health; installedModels: InstalledModel[]; safeMode: boolean; hardware: Hardware },
): Health {
  if (h.engine_build) lastBuild = h.engine_build;
  let engine = ENGINE_STATE[h.engine];
  if (engine === "not_started" && h.engine_idle_unloaded) engine = "idle_unloaded";
  if (engine === "not_started" && s.installedModels.length === 0) engine = "no_model";
  const fileName = (path: string) => path.split(/[\\/]/).pop();
  const loaded = h.engine_model ? s.installedModels.find((m) => fileName(m.file_path) === h.engine_model) : undefined;
  return {
    ...s.health,
    engine,
    engine_build: h.engine_build ?? nextBuild(h, s),
    loaded_model_id: loaded?.id ?? null,
  };
}

/** Engine state from the backend. A GPU-to-CPU fallback raises the shared notice once per session,
 * so dismissing it is respected (the store is new each time the app starts). */
export async function refreshHealth(): Promise<void> {
  const newest = ticket("health");
  const h = await bridge().system.health();
  if (!newest()) return;
  useStore.setState((s) => ({
    health: toEngineHealth(h, {
      health: s.health,
      installedModels: s.installedModels,
      safeMode: s.settings.safe_mode_cpu,
      hardware: s.hardware,
    }),
    ...(h.engine_cpu_fallback && s.fallbackNotice === null
      ? { fallbackNotice: { at: new Date().toISOString(), dismissed: false } }
      : {}),
  }));
}

/** For callers where the engine state is a bonus: a failed read never fails what they did. */
export const refreshHealthQuietly = (): Promise<void> => refreshHealth().catch(() => undefined);

export const HEALTH_POLL_MS = 10_000;
let healthPoll: ReturnType<typeof setInterval> | undefined;

/** Keep the engine state current on every screen. A missed poll is not an error worth a toast. */
export function startHealthPoll(): void {
  if (healthPoll !== undefined) return;
  healthPoll = setInterval(() => void refreshHealthQuietly(), HEALTH_POLL_MS);
}

/* ------------------------------------------------------------------ model downloads */
export const DOWNLOAD_POLL_MS = 1_000;
let downloadPoll: ReturnType<typeof setInterval> | undefined;
const RUNNING = new Set(["queued", "downloading", "verifying"]);

/** GET /models/downloads into the store. A finished download becomes an installed model, so
 * the models, the settings (default model) and the evidence (model_installed) are read again. */
export async function refreshDownloads(): Promise<void> {
  const list = await bridge().models.downloads();
  const finished = list.some((d) => d.status === "done");
  useStore.setState({
    downloads: Object.fromEntries(
      list
        .filter((d) => d.status !== "done")
        .map((d) => [d.entry_id, { ...d, error: d.error ? messageFor(new Error(d.error)) : undefined }]),
    ),
  });
  if (finished) await Promise.all([refreshModels(), refreshSettings(), refreshEvents().catch(() => undefined)]);
  if (list.some((d) => RUNNING.has(d.status))) watchDownloads();
  else stopWatchingDownloads();
}

/** Poll once a second while a download runs; it stops by itself when none does. */
export function watchDownloads(): void {
  if (downloadPoll !== undefined) return;
  downloadPoll = setInterval(() => void refreshDownloads().catch(() => undefined), DOWNLOAD_POLL_MS);
}

export function stopWatchingDownloads(): void {
  if (downloadPoll === undefined) return;
  clearInterval(downloadPoll);
  downloadPoll = undefined;
}

/** Everything a signed-in workspace shows. Messages load per conversation. */
export async function refreshWorkspace(): Promise<void> {
  await refreshProjects();
  await Promise.all([refreshConversations(), refreshEvents(), refreshModels()]);
  await refreshHealthQuietly(); // after the models: the loaded model is matched against them
  // Facts for Settings and the Evidence tab: a failed read never fails the workspace.
  await Promise.all([refreshSystem().catch(() => undefined), refreshStream().catch(() => undefined)]);
}

/** Run a change against the backend, then reload what it touched. Failures become a toast. */
export async function change<T>(
  title: string,
  call: () => Promise<T>,
  after: () => Promise<unknown> = refreshWorkspace,
): Promise<T | undefined> {
  try {
    const result = await call();
    await after();
    return result;
  } catch (err) {
    reportFailure(err, title);
    return undefined;
  }
}

/** Load everything live before the first render, so the first-run guard sees the real state. */
export async function hydrate(): Promise<void> {
  if (!isLive()) return;
  try {
    const status = await refreshStatus();
    await refreshSettings();
    if (status.first_run_complete) await refreshWorkspace();
    else await refreshModels(true); // setup shows this machine's hardware and installed models
    await refreshDownloads().catch(() => undefined); // a download that ran before a restart
    startHealthPoll();
  } catch (err) {
    reportFailure(err, "Could not reach the AIOS backend");
  }
}
