/**
 * Live data: in the desktop app, every screen's data comes from the backend through window.aios.
 *
 * The screens read the zustand store (`@/lib/store`); this module loads the backend's data into it
 * and is called again after each change, so every screen shows what the backend holds. In a plain
 * browser (`pnpm dev:ui`) the same code runs against the simulated backend in `./sim` (sample data).
 *
 * Areas the backend does not have yet (resources, voice) start empty in the desktop app and say
 * they are not in this build.
 */
import {
  errorCode,
  type Conversation as LiveConversation,
  type EvidenceEvent as LiveEvent,
  type EvidenceStream as LiveStream,
  type Hardware as LiveHardware,
  type Health as LiveHealth,
  type InstalledModel as LiveModel,
  type KnowledgeDoc as LiveKnowledgeDoc,
  type Message as LiveMessage,
  type Project as LiveProject,
  type Settings as LiveSettings,
  type SetupStatus,
  type SystemStatus as LiveSystemStatus,
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
  KnowledgeDoc,
  Message,
  Project,
} from "@/lib/types";
import { ZERO_HASH } from "@/lib/hash";
import { useStore, type LiveFacts } from "@/lib/store";
import { setCatalogue } from "@/data/catalogue";
import { useExtras } from "@/lib/extras";
import { bridge, inElectron } from "./index";

export const isLive = inElectron;

/** Plain-language text for the backend's error codes the person can hit. */
const MESSAGES: Record<string, string> = {
  store_exists: "The store on this computer was already created; its recovery key was shown then.",
  store_not_created: "The encrypted store has not been created yet. Go back to “Protect your work”.",
  invalid_setting: "That setting cannot be empty.",
  update_check_off: "Update checks are switched off.",
  invalid_path: "That location can't be used. Choose another file or folder.",
  skill_added: "That skill is already added. It is in your list.",
  skill_needs_voice_model: "This skill needs the speech model. Download it in Settings, Voice, then add the skill.",
  skill_included: "That skill comes with AIOS and is always there.",
  not_a_skill_file: "That is not a skill file. A skill file ends .aios-skill.",
  skill_file_invalid: "AIOS could not read that skill file. It needs a name, a line saying what it does and an instruction.",
  too_many_files: "That folder has more than 500 files. Choose a smaller folder, or add the files you need.",
  document_not_found: "A document you chose is no longer in My secure knowledge. Choose it again.",
  log_folder_missing: "There is no log folder yet, so there is nothing to put in a diagnostic file.",
  catalogue_check_off: "The check for new AI models is switched off.",
  catalogue_unreachable: "The list of AI models can't be reached. Check the connection and try again.",
  catalogue_signature_invalid: "The list of AI models that came back could not be verified.",
  no_recovery_package:
    "No recovery file was found in that folder. Choose the backup of the data folder that contains recovery.pkg.",
  no_backup_database: "That folder has no chats.db. Choose the backup of the whole data folder.",
  r_checksum: "The recovery key has a typing error. Check it character by character.",
  r_unwrap: "The recovery key doesn't match this backup. Check it character by character.",
  r_mismatch: "This recovery key belongs to a different AIOS than the backup in that folder.",
  r_format: "recovery.pkg in that folder is damaged or not a recovery file.",
  r_kdf_params: "recovery.pkg in that folder uses settings this version does not accept.",
  r_payload: "recovery.pkg in that folder is damaged.",
  restore_failed: "Restoring failed and everything was put back as it was.",
  invalid_request: "The request was not valid.",
  project_not_found: "That project no longer exists.",
  conversation_not_found: "That conversation no longer exists.",
  model_not_found: "That AI model is not installed.",
  catalogue_entry_not_found: "That AI model is not in the list.",
  confirmation_required: "This needs your confirmation first.",
  company_provider_disabled: "The company server is not available on this installation.",
  no_model: "No AI model is installed yet. Add one in AI models.",
  model_missing: "No installed AI model can answer. Add one in AI models.",
  company_unreachable: "The company server can't be reached.",
  empty_message: "The message is empty.",
  message_too_large: "This message is too long for the AI model. Shorten it or split it up.",
  nothing_to_regenerate: "There is no answer to ask again yet.",
  file_not_readable: "That file can't be read.",
  p_zip: "That file is not a project file (it is not a valid archive).",
  p_format: "That file is not a project file this version can read.",
  p_checksum: "The file is damaged: a checksum does not match. Nothing was added.",
  p_reference: "The file is damaged: it refers to records it does not contain. Nothing was added.",
  p_unlisted: "The file contains parts it does not list. Nothing was added.",
  p_missing: "The file is missing parts it lists. Nothing was added.",
  writer_unavailable: "Activity recording is paused, so the copy can't be made yet. Every action is kept and waits.",
  no_backup_location: "Choose where backups go first.",
  backup_location_unavailable:
    "The backup folder can't be reached. Plug in the drive, or choose another folder. Nothing was changed.",
  backup_failed: "The backup could not be written to that folder. Check there is space, then try again. Nothing was changed.",
  backup_unreadable: "The copy did not pass its check, so it was not kept. Try again. Nothing was changed.",
  backup_incomplete: "The backup was missing a file, so it was not kept. Try again. Nothing was changed.",
  size_mismatch: "That file is not the AI model you chose: its size is different.",
  digest_mismatch: "That file is not the genuine AI model: its fingerprint is different. It was not installed.",
  deviation_not_approved: "That AI model has not passed its review yet, so it can't be installed.",
  not_gguf: "Choose a .gguf AI model file.",
  model_installed: "That AI model is already installed.",
  mirror_unavailable: "Downloading isn't available in this build yet. Use the AI model file from the installer instead.",
  not_in_electron: "This needs the desktop app.",
  mirror_unreachable:
    "The download stopped: the publisher could not be reached. What arrived is kept; carry on when you are online.",
  download_incomplete: "The download ended early. What arrived is kept; carry on to finish it.",
  download_exists: "This AI model is already downloading.",
  not_enough_disk: "Not enough free space on this computer for this AI model.",
  host_not_allowed: "The download was sent to a place AIOS does not allow, so it was stopped.",
  engine_failed: "The AI model could not answer. Try again; if it keeps failing, restart AIOS.",
  busy: "AIOS is writing an answer. Wait for it to finish, or stop it, then try again.",
  model_in_use: "AIOS is writing an answer with this AI model. Wait for it to finish, or stop it, then try again.",
  package_file_not_found: "The AI model file from the installer package is no longer there.",
  // Pictures and videos (R-7)
  media_unavailable: "Pictures and videos can't be made right now. Try again in a moment.",
  media_not_offered: "The company server doesn't make pictures or videos yet.",
  media_unreachable: "The company server can't be reached. Check the connection and try again.",
  media_busy: "The company server is busy with other pictures and videos. Try again in a few minutes.",
  media_not_ready: "This picture or video isn't finished yet.",
  media_not_found: "That picture or video no longer exists.",
  media_bad_answer: "The company server sent something AIOS doesn't accept, so it was not kept.",
  media_output_too_large: "The finished file was too large to keep.",
  company_key_missing: "The company server's key isn't set up on this computer.",
  company_key_rejected: "The company server refused this computer's key. Ask your administrator for the current key.",
  project_archived: "This project is archived. Restore it first.",
  unknown_model: "That model isn't on the company server.",
  kind_mismatch: "That model makes a different kind of file.",
  invalid_prompt: "Describe what to make (up to 2,000 characters).",
  prompt_too_long: "The description is too long. Keep it under 2,000 characters.",
  negative_prompt_too_long: "The “leave out” text is too long. Keep it under 1,000 characters.",
  invalid_size: "That size isn't available for this kind of file.",
  invalid_frames: "That video length isn't available.",
  invalid_seed: "The variation number must be a whole number from 0 to 4,294,967,295.",
  queue_full: "The company server is busy with other pictures and videos. Try again in a few minutes.",
};

export function messageFor(err: unknown): string {
  const code = errorCode(err);
  return MESSAGES[code] ?? `Something went wrong (${code}).`;
}

/** Show a failed call as a toast. The screen keeps its last good state. */
export function reportFailure(err: unknown, title: string): void {
  useStore.getState().toast({ kind: "deny", title, description: messageFor(err) });
}

/** The words for a part of the design the backend does not have yet. */
export function notInThisBuild(what: string): void {
  useStore.getState().toast({
    kind: "info",
    title: `${what} is not in this build yet`,
    description: "It comes in a later version of AIOS. Nothing was changed.",
  });
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
  backup_created: "export",
  inference_completed: "request",
  project_exported: "export",
  project_imported: "import",
};

export function toEvent(e: LiveEvent, streamId: string): EvidenceEvent {
  const payload = { ...e.payload };
  // A backup is shown as the design's "Backed up your AIOS" (an export of kind backup).
  if (e.event_type === "backup_created") payload.kind = "backup";
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
    model_digest: typeof payload.model_digest === "string" ? payload.model_digest : undefined,
    // Hashes and signatures exist only once the evidence writer has appended the event.
    prev_hash: ZERO_HASH,
    event_hash: ZERO_HASH,
    payload,
    pending: e.pending,
  };
}

export const toModel = (m: LiveModel): InstalledModel => ({ ...m });

/** The backend's last benchmark when it reports one (null: none has run on this computer). */
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

/**
 * Backend settings into the store. Until the mirror has been checked, the version shown is the
 * bundled catalogue's. The backup and recovery key fields come from the setup status (`applyStatus`).
 */
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

function setLive(patch: Partial<LiveFacts>): void {
  useStore.setState((s) => ({
    live: { allowlist: [], licences: [], databaseLocked: false, ...s.live, ...patch },
  }));
}

/** Company server and the writer as the backend reports them (Settings, project header, message box). */
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

/** The activity record's stream (Activity › Verification details). The device id comes from the writer. */
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

export function applyAllowlist(entries: Awaited<ReturnType<ReturnType<typeof bridge>["settings"]["network"]>>): void {
  setLive({ allowlist: entries.map((e) => ({ id: e.id, host: e.host, purpose: e.purpose, kind: e.kind, enabled: e.enabled })) });
}

/** Setup status into the store: first-run state and the store's stream identity. */
export function applyStatus(status: SetupStatus): void {
  // The backend has no finished setup but the browser storage still says it has (for example after
  // the data folder was reset): setup starts again from its first step, with nothing from before.
  const restart = !status.first_run_complete && useStore.getState().ui.firstRunComplete;
  useStore.setState((s) => ({
    ui: {
      ...s.ui,
      firstRunComplete: status.first_run_complete,
      ...(restart ? { freshInstall: true, lastProjectId: null, setup: { step: 0, keyShownUnconfirmed: false } } : {}),
    },
    stream: {
      ...s.stream,
      stream_id: status.stream_id ?? s.stream.stream_id,
      signer_key_id: status.signing_key_id ?? s.stream.signer_key_id,
    },
    // Backup (decision D3): where backups go and the last one, as the backend records them.
    settings: {
      ...s.settings,
      backup_location: status.backup_location ?? null,
      last_backup_at: status.last_backup_at ?? null,
      last_backup_size: status.last_backup_size ?? null,
      recovery_key_issued_at: status.recovery_key_issued_at ?? null,
    },
  }));
}

/** A document as the screens show it. */
export function toKnowledgeDoc(d: LiveKnowledgeDoc): KnowledgeDoc {
  return {
    id: d.id,
    name: d.name,
    kind: d.kind,
    size_bytes: d.size_bytes,
    pages: d.pages ?? undefined,
    collection: d.collection,
    origin: d.origin,
    added_at: d.added_at,
    status: d.status,
    problem: d.problem ?? undefined,
  };
}

/** Before loading: forget what an earlier load put in the store, so nothing stale is shown. */
export function clearLoaded(): void {
  useExtras.setState({ knowledge: [], skillCatalogue: [], installedSkills: [], skillInstalls: {} });
  useStore.setState((s) => ({
    projects: [],
    conversations: [],
    messages: [],
    summaries: [],
    installedModels: [],
    downloads: {},
    events: [],
    checkpoints: [],
    generation: null,
    continueLocally: null,
    modelChoice: null,
    fallbackNotice: null,
    recoveryKey: null,
    updateNotice: null,
    live: { allowlist: [], licences: [], databaseLocked: false },
    settings: {
      ...s.settings,
      update_available: null,
      backup_location: null,
      last_backup_at: null,
      last_backup_size: null,
      recovery_key_issued_at: null,
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
  // The list of AI models AIOS may install comes from the backend (GET /models/catalogue).
  try {
    const catalogue = await bridge().models.catalogue();
    bundledCatalogue = catalogue.version;
    setCatalogue(catalogue.entries.map((e) => ({ ...e, deviation_approval: e.deviation_approval ?? undefined })));
  } catch {
    // The list and version shown stay as they are; the settings themselves still load.
  }
  const [settings, network] = await Promise.all([bridge().settings.get(), bridge().settings.network()]);
  applySettings(settings);
  applyAllowlist(network);
}

/** Company server, writer state (GET /system/status) and build facts (GET /system/info). */
export async function refreshSystem(): Promise<void> {
  const [status, info] = await Promise.all([bridge().system.status(), bridge().system.info()]);
  applySystemStatus(status);
  setLive({ licences: info.licences });
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

/** All conversations of all projects (the menu and search list them across projects). */
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
  const [list, summary] = await Promise.all([
    bridge().conversations.messages(conversationId),
    // The summary of the earlier messages of a long conversation (M-07); a failed read shows none.
    bridge().conversations.summary(conversationId).catch(() => null),
  ]);
  if (!newest()) return;
  const conversation = useStore.getState().conversations.find((c) => c.id === conversationId);
  const messages = toMessages(list, conversation);
  useStore.setState((s) => ({
    messages: [...s.messages.filter((m) => m.conversation_id !== conversationId), ...messages],
    summaries: [...s.summaries.filter((x) => x.conversation_id !== conversationId), ...(summary ? [summary] : [])],
  }));
}

/** GET /knowledge: My secure knowledge. */
export async function refreshKnowledge(): Promise<void> {
  const current = ticket("knowledge");
  const docs = (await bridge().knowledge.list()).map(toKnowledgeDoc);
  if (current()) useExtras.setState({ knowledge: docs });
}

/** GET /skills: what can be added, and what the AI has. */
export async function refreshSkills(): Promise<void> {
  const current = ticket("skills");
  const { catalogue, installed } = await bridge().skills.list();
  if (!current()) return;
  useExtras.setState({
    skillCatalogue: catalogue.map((e) => ({ ...e, included: e.included ?? undefined, own: e.own ?? undefined, available: e.available ?? undefined })),
    installedSkills: installed,
  });
}

export async function refreshEvents(): Promise<void> {
  const newest = ticket("events");
  const [events, status, checkpoints] = await Promise.all([
    bridge().evidence.list(),
    bridge().evidence.status(),
    // A writer that has not run yet: the record shows without checkpoints.
    bridge().evidence.checkpoints().catch(() => []),
  ]);
  if (!newest()) return;
  const streamId = useStore.getState().stream.stream_id;
  useStore.setState((s) => ({
    events: events.map((e) => toEvent(e, streamId)).sort((a, b) => a.seq - b.seq),
    checkpoints: [...checkpoints].sort((a, b) => a.seq_to - b.seq_to),
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

/** No engine running: the build the next start will use. Processor with "Use the processor only" or
 * after a fallback; otherwise the build it last ran on, or the graphics-card build only if a card
 * with its own memory and a working driver was found. The backend decides for real when it starts. */
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

/** Engine state from the backend. A graphics-card-to-processor fallback raises the shared notice once
 * per session, so dismissing it is respected (the store is new each time the app starts). */
export async function refreshHealth(): Promise<void> {
  const newest = ticket("health");
  const h = await bridge().system.health();
  if (!newest()) return;
  setLive({ databaseLocked: h.database === "locked" });
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
 * the models, the settings (default model) and the activity record (model_installed) are read again. */
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

/** Everything a set-up workspace shows. Messages load per conversation. */
export async function refreshWorkspace(): Promise<void> {
  await refreshProjects();
  await Promise.all([refreshConversations(), refreshEvents(), refreshModels(), refreshKnowledge(), refreshSkills()]);
  await refreshHealthQuietly(); // after the models: the loaded model is matched against them
  // Facts for Settings and Activity: a failed read never fails the workspace.
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

/** Load everything before the first render, so the start-up gate sees the real state. Desktop app: from the
 * backend. Plain browser: from the simulated backend in `./sim` (sample data). */
export async function hydrate(): Promise<void> {
  clearLoaded();
  try {
    await refreshHealthQuietly(); // a locked database shows "cannot open your data"
    const status = await refreshStatus();
    await refreshSettings();
    if (status.first_run_complete) await refreshWorkspace();
    else await refreshModels(true); // setup shows this computer's hardware and installed models
    await refreshDownloads().catch(() => undefined); // a download that ran before a restart
    startHealthPoll();
  } catch (err) {
    reportFailure(err, "Could not reach the AIOS backend");
  }
}

/* ------------------------------------------------------------------ live answers */
export const ANSWER_POLL_MS = 250;

/**
 * Show an answer while it is written (GET /conversations/{id}/generation reports the text so far).
 * `question`: the words just sent, shown at once as the person's message. Returns a function that
 * ends the live view; the stored messages are loaded after the call, replacing what was shown.
 */
export function watchAnswer(conversationId: string, question: string | null): () => void {
  const conv = useStore.getState().conversations.find((c) => c.id === conversationId);
  const tempId = `sending-${Date.now()}`;
  if (question !== null && conv) {
    const pending: Message = {
      id: tempId,
      conversation_id: conversationId,
      role: "user",
      content: question,
      classification_effective: conv.classification_effective,
      classification_source: conv.classification_source,
      status: "complete",
      provider: conv.current_provider,
      model_id: conv.model_id,
      prompt_tokens: 0,
      completion_tokens: 0,
      created_at: new Date().toISOString(),
    };
    useStore.setState((s) => ({ messages: [...s.messages, pending] }));
  }
  let done = false;
  const tick = async () => {
    if (done) return;
    try {
      const g = await bridge().conversations.generation(conversationId);
      if (done) return;
      if (!g.generating || !g.message_id || !g.phase || !g.provider) return;
      const messageId = g.message_id;
      const phase = g.phase;
      const provider = g.provider;
      const text = g.text ?? "";
      useStore.setState((s) => {
        const existing = s.messages.find((m) => m.id === messageId);
        const streaming: Message = existing
          ? { ...existing, content: text || existing.content, status: "streaming" }
          : {
              id: messageId,
              conversation_id: conversationId,
              role: "assistant",
              content: text,
              classification_effective: conv?.classification_effective ?? "restricted",
              classification_source: conv?.classification_source ?? "project",
              status: "streaming",
              provider,
              model_id: conv?.model_id ?? null,
              prompt_tokens: 0,
              completion_tokens: 0,
              created_at: new Date().toISOString(),
            };
        return {
          generation: { conversation_id: conversationId, message_id: messageId, phase, provider },
          messages: existing ? s.messages.map((m) => (m.id === messageId ? streaming : m)) : [...s.messages, streaming],
        };
      });
    } catch {
      // A missed poll only delays the words; the stored answer arrives when the call ends.
    }
  };
  void tick();
  const poll = setInterval(() => void tick(), ANSWER_POLL_MS);
  return () => {
    done = true;
    clearInterval(poll);
    useStore.setState((s) => ({
      generation: s.generation?.conversation_id === conversationId ? null : s.generation,
      messages: s.messages.filter((m) => m.id !== tempId),
    }));
  };
}
