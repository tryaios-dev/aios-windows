/**
 * The window.aios bridge: the renderer's only door to the system.
 * Main validates every call against these schemas before it reaches the backend.
 * Add a feature here first, then in main (ipc/) and preload, then in the UI.
 *
 * Shapes mirror the backend schemas (contracts/local-api/openapi.json). Times are ISO 8601 strings.
 */
import { z } from "zod";

/* ------------------------------------------------------------------ system */
const ComponentState = z.enum(["not_started", "starting", "ok", "degraded", "failed"]);

export const Health = z.object({
  backend: z.string(),
  database: z.enum(["ok", "locked", "error"]),
  engine: ComponentState,
  /** Build of the starting or running engine. */
  engine_build: z.enum(["cpu", "vulkan"]).nullable(),
  /** Model file of the starting or running engine. */
  engine_model: z.string().nullable(),
  /** The GPU build failed this session; the engine runs on the CPU build (tell the user). */
  engine_cpu_fallback: z.boolean(),
  /** Unloaded after the idle period; the next message starts it again. */
  engine_idle_unloaded: z.boolean(),
  evidence_writer: ComponentState,
  version: z.string(),
});
export type Health = z.infer<typeof Health>;

/** Backend, engine, evidence writer and Company AI in one call (sidebar dots, Settings > Health). */
export const SystemStatus = z.object({
  backend: z.string(),
  database: z.string(),
  version: z.string(),
  engine: z.object({
    state: z.string(),
    build: z.enum(["cpu", "vulkan"]).nullable(),
    loaded_model_id: z.string().nullable(),
  }),
  writer: z.object({ state: z.enum(["ok", "unavailable"]), pending: z.number().int() }),
  company: z.object({
    enabled: z.boolean(),
    reachable: z.boolean(),
    base_url: z.string().nullable(),
    model_name: z.string().nullable(),
  }),
  generating_conversation_id: z.string().nullable(),
});
export type SystemStatus = z.infer<typeof SystemStatus>;

/** Build facts for Settings > About and Data. */
export const SystemInfo = z.object({
  app_version: z.string(),
  profile: z.enum(["desktop", "dev", "test"]),
  schema_version: z.number().int(),
  data_paths: z.object({
    root: z.string(),
    chats_db: z.string(),
    recovery_package: z.string(),
    models: z.string(),
    logs: z.string().nullable(),
    backups: z.string(),
  }),
  licences: z.array(z.object({ name: z.string(), role: z.string(), licence: z.string() })),
});
export type SystemInfo = z.infer<typeof SystemInfo>;

/** A zip of the log folder, written where the user chose (Settings > Health). */
export const SupportBundle = z.object({
  file_name: z.string(),
  path: z.string(),
  size_bytes: z.number().int(),
  file_count: z.number().int(),
  created_at: z.string(),
});
export type SupportBundle = z.infer<typeof SupportBundle>;

/**
 * A link from a model answer the user clicked (M-20). Web links only, no credentials; Electron main
 * still asks the user to confirm in its own dialog before anything opens.
 */
export const ExternalLink = z
  .string()
  .max(2048)
  // http(s), a host with no user or password part, optional port, then a path, query or fragment.
  .regex(/^https?:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?(?:[/?#][^\s]*)?$/, "not_a_web_link");

/** Ids sent from the renderer: checked before they are put into a URL path. */
export const Id = z.string().regex(/^[A-Za-z0-9._-]{1,64}$/);

/** A file or folder the user picked in a system dialog. */
export const PickedFile = z.object({ path: z.string(), file_name: z.string(), size_bytes: z.number().int() });
export type PickedFile = z.infer<typeof PickedFile>;

/* ------------------------------------------------------------------ setup */
export const SetupStatus = z.object({
  first_run_complete: z.boolean(),
  store_created: z.boolean(),
  stream_id: z.string().nullable(),
  signing_key_id: z.string().nullable(),
  package_id: z.string().nullable(),
  default_project_id: z.string().nullable(),
  completed_at: z.string().nullable(),
  last_restore_at: z.string().nullable(),
  recovery_package_present: z.boolean(),
  /** Backup (decision D3): the chosen folder, and when the last backup was made and its size. */
  backup_location: z.string().nullable().optional(),
  last_backup_at: z.string().nullable().optional(),
  last_backup_size: z.number().int().nullable().optional(),
  /** When the current recovery key was shown (first run, or a new key: decision D4). */
  recovery_key_issued_at: z.string().nullable().optional(),
});
export type SetupStatus = z.infer<typeof SetupStatus>;

/** `recovery_key` is in this reply exactly once; nothing keeps it. */
export const StoreCreated = z.object({
  recovery_key: z.string(),
  package_id: z.string(),
  stream_id: z.string(),
  signing_key_id: z.string(),
});
export type StoreCreated = z.infer<typeof StoreCreated>;

export const Completed = z.object({ default_project_id: z.string() });
export type Completed = z.infer<typeof Completed>;

export const RestoreInput = z.object({
  backup_path: z.string().min(1).max(1024),
  recovery_key: z.string().min(1).max(100),
  /** Required (true) by the backend when a finished installation would be replaced. */
  confirmed: z.boolean().optional(),
});
export type RestoreInput = z.infer<typeof RestoreInput>;

export const Restored = z.object({
  stream_id: z.string(),
  /** The evidence epoch the restore started. */
  epoch: z.number().int().nullable().optional(),
});
export type Restored = z.infer<typeof Restored>;

/** One document in My secure knowledge: an encrypted copy in chats.db; the original is never changed. */
export const KnowledgeDoc = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.string(),
  size_bytes: z.number().int(),
  pages: z.number().int().nullable().optional(),
  collection: z.string(),
  origin: z.string(),
  added_at: z.string(),
  status: z.enum(["ready", "failed"]),
  problem: z.string().nullable().optional(),
});
export type KnowledgeDoc = z.infer<typeof KnowledgeDoc>;

/** What adding a folder would copy, shown before anything is added. */
export const FolderPreview = z.object({
  name: z.string(),
  path: z.string(),
  files: z.array(
    z.object({
      name: z.string(),
      size_bytes: z.number().int(),
      kind: z.string(),
      problem: z.string().nullable(),
      already: z.boolean(),
    }),
  ),
});
export type FolderPreview = z.infer<typeof FolderPreview>;

/** Absolute paths of files to add (from the file dialog, or dropped on the page). */
export const KnowledgePaths = z.array(z.string().min(1).max(1024)).min(1).max(500);
/** The collection dropped loose files go into; folders are named after themselves. */
export const KnowledgeCollection = z.string().min(1).max(260).optional();
/** Documents chosen for one question. */
export const KnowledgeIds = z.array(z.string().min(1).max(64)).max(50).optional();

/** A skill: an instruction the AI on this computer follows while it is on. */
export const SkillEntry = z.object({
  id: z.string(),
  name: z.string(),
  line: z.string(),
  detail: z.string(),
  category: z.enum(["Writing", "Documents", "Numbers", "Voice", "Languages", "Images"]),
  publisher: z.string(),
  licence: z.string(),
  open_source: z.boolean(),
  size_bytes: z.number().int(),
  version: z.string(),
  uses: z.array(z.string()),
  example: z.string(),
  included: z.boolean().optional(),
  own: z.boolean().optional(),
  /** False: listed, but it cannot be added in this build yet. */
  available: z.boolean().optional(),
});
export type SkillEntry = z.infer<typeof SkillEntry>;
export const InstalledSkill = z.object({ id: z.string(), installed_at: z.string(), enabled: z.boolean() });
export type InstalledSkill = z.infer<typeof InstalledSkill>;
export const Skills = z.object({ catalogue: z.array(SkillEntry), installed: z.array(InstalledSkill) });
export type Skills = z.infer<typeof Skills>;
/** What a .aios-skill file holds, shown before it is added. */
export const SkillFileCheck = z.object({ entry: SkillEntry, file_name: z.string(), already_added: z.boolean() });
export type SkillFileCheck = z.infer<typeof SkillFileCheck>;

/** A folder the user picked in the system dialog, with what main found in it. */
/** Where backups go, chosen in the system folder dialog; null clears it ("Set up later"). */
export const BackupLocation = z.string().min(1).max(1024).nullable();

/** One backup (POST /backup): a new folder in the chosen location that restore accepts as it is. */
export const BackupResult = z.object({
  path: z.string(),
  size_bytes: z.number().int(),
  files: z.number().int(),
  conversations: z.number().int(),
  at: z.string(),
});
export type BackupResult = z.infer<typeof BackupResult>;

/** A new recovery key (POST /recovery-key). `recovery_key` is in this reply exactly once. */
export const NewRecoveryKey = z.object({ recovery_key: z.string(), package_id: z.string(), issued_at: z.string() });
export type NewRecoveryKey = z.infer<typeof NewRecoveryKey>;

export const BackupFolder = z.object({
  path: z.string(),
  has_recovery_package: z.boolean(),
  has_database: z.boolean(),
});
export type BackupFolder = z.infer<typeof BackupFolder>;

/* ------------------------------------------------------------------ settings */
export const UpdateAvailable = z.object({ version: z.string(), size_bytes: z.number().int().nonnegative() });

export const Settings = z.object({
  update_check: z.boolean(),
  catalogue_check: z.boolean(),
  safe_mode_cpu: z.boolean(),
  default_model_id: z.string().nullable(),
  /** Voice: the languages the person speaks, main first (Whisper codes); null until chosen. */
  voice_languages: z.array(z.string()).nullable(),
  last_update_check: z.string().nullable(),
  last_catalogue_check: z.string().nullable(),
  update_available: UpdateAvailable.nullable(),
  app_version: z.string(),
  catalogue_version: z.string().nullable(),
  schema_version: z.number().int(),
});
export type Settings = z.infer<typeof Settings>;

export const SettingsPatch = z
  .object({
    update_check: z.boolean(),
    catalogue_check: z.boolean(),
    safe_mode_cpu: z.boolean(),
    default_model_id: z.string().min(1).max(100).nullable(),
    /** Empty or null: no choice, the computer's languages are used. */
    voice_languages: z
      .array(z.string().regex(/^[a-z]{2,3}$/))
      .max(5)
      .nullable(),
  })
  .partial()
  .strict();
export type SettingsPatch = z.infer<typeof SettingsPatch>;

export const AllowlistEntry = z.object({
  id: z.string(),
  host: z.string(),
  port: z.number().int(),
  purpose: z.string(),
  kind: z.enum(["fixed", "configured"]),
  enabled: z.boolean(),
});
export type AllowlistEntry = z.infer<typeof AllowlistEntry>;

/** Result of asking the model mirror which catalogue it offers. */
export const CatalogueCheck = z.object({ version: z.string(), changed: z.boolean(), checked_at: z.string() });
export type CatalogueCheck = z.infer<typeof CatalogueCheck>;

/* ------------------------------------------------------------------ projects */
export const Classification = z.enum(["restricted", "internal", "public"]);
export type Classification = z.infer<typeof Classification>;
export const ClassificationSource = z.enum(["project", "import", "review"]);
export const Provider = z.enum(["local", "company"]);
export type Provider = z.infer<typeof Provider>;

export const Project = z.object({
  id: z.string(),
  name: z.string(),
  classification: Classification,
  classification_source: ClassificationSource,
  derived_from_project_id: z.string().nullable(),
  company_ai_enabled: z.boolean(),
  archived: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Project = z.infer<typeof Project>;

export const ProjectCreate = z.object({ name: z.string().min(1).max(200), classification: Classification }).strict();
export type ProjectCreate = z.infer<typeof ProjectCreate>;

export const ProjectPatch = z
  .object({ name: z.string().min(1).max(200), archived: z.boolean() })
  .partial()
  .strict();
export type ProjectPatch = z.infer<typeof ProjectPatch>;

export const Reclassified = z.object({ project: Project, reviewed_copy: z.boolean() });
export type Reclassified = z.infer<typeof Reclassified>;

export const ExportPackageInput = z.object({ file_name: z.string().min(1).max(200), confirmed: z.boolean() }).strict();
export type ExportPackageInput = z.infer<typeof ExportPackageInput>;

export const PackageExport = z.object({
  file_name: z.string(),
  path: z.string(),
  size_bytes: z.number().int(),
  checksum: z.string(),
  package_id: z.string(),
  evidence_seq: z.number().int().nullable(),
});
export type PackageExport = z.infer<typeof PackageExport>;

export const PackageImport = z.object({
  project_id: z.string(),
  project_name: z.string(),
  conversations: z.number().int(),
  messages: z.number().int(),
  summaries: z.number().int(),
  warnings: z.array(z.string()),
  remapped: z.boolean(),
});
export type PackageImport = z.infer<typeof PackageImport>;

/* ------------------------------------------------------------------ chat */
export const Conversation = z.object({
  id: z.string(),
  project_id: z.string(),
  title: z.string(),
  classification_effective: Classification,
  classification_source: ClassificationSource,
  provider_mode: Provider,
  current_provider: Provider,
  model_id: z.string().nullable(),
  archived: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
  last_message_preview: z.string().nullable(),
  moves: z.array(z.object({ to: Provider, at: z.string() })),
});
export type Conversation = z.infer<typeof Conversation>;

export const ConversationPatch = z
  .object({ title: z.string().min(1).max(500), archived: z.boolean(), model_id: z.string().min(1).max(100) })
  .partial()
  .strict();
export type ConversationPatch = z.infer<typeof ConversationPatch>;

export const Message = z.object({
  id: z.string(),
  conversation_id: z.string(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  classification_effective: Classification,
  classification_source: ClassificationSource,
  status: z.enum(["complete", "partial", "error", "stopped"]),
  provider: Provider,
  model_id: z.string().nullable(),
  prompt_tokens: z.number().int(),
  completion_tokens: z.number().int(),
  created_at: z.string(),
  evidence_pending: z.boolean(),
  evidence_seq: z.number().int().nullable(),
  previous_versions: z.array(z.string()),
  continued_from: z.string().nullable(),
});
export type Message = z.infer<typeof Message>;

export const Exchange = z.object({ user: Message.nullable(), assistant: Message });
export type Exchange = z.infer<typeof Exchange>;

/** The summary of the earlier part of a long conversation (M-07). */
export const ConversationSummary = z.object({
  id: z.string(),
  conversation_id: z.string(),
  covers_until_message_id: z.string(),
  content: z.string(),
  classification_effective: Classification,
  classification_source: ClassificationSource,
  model_id: z.string(),
  provider: Provider,
  created_at: z.string(),
});
export type ConversationSummary = z.infer<typeof ConversationSummary>;

/** Whether a conversation is answering right now, and the answer so far (live answers, Stop). */
export const GenerationState = z.object({
  generating: z.boolean(),
  message_id: z.string().nullable(),
  phase: z.enum(["loading_engine", "preparing", "streaming"]).nullable(),
  provider: Provider.nullable(),
  text: z.string().nullable().optional(),
});
export type GenerationState = z.infer<typeof GenerationState>;

export const ProvidersStatus = z.object({ local_ready: z.boolean(), company_enabled: z.boolean() });
export type ProvidersStatus = z.infer<typeof ProvidersStatus>;

/* ------------------------------------------------------------------ search */
export const SearchHit = z.object({
  message_id: z.string(),
  conversation_id: z.string(),
  project_id: z.string(),
  snippet: z.string(),
  created_at: z.string(),
  role: z.enum(["user", "assistant"]),
});
export type SearchHit = z.infer<typeof SearchHit>;

/* ------------------------------------------------------------------ evidence */
export const EvidenceEvent = z.object({
  id: z.number().int(),
  event_id: z.string(),
  event_type: z.string(),
  actor: z.enum(["user", "app", "operator"]),
  ts: z.string(),
  project_id: z.string().nullable(),
  conversation_id: z.string().nullable(),
  payload: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  seq: z.number().int().nullable(),
  pending: z.boolean(),
});
export type EvidenceEvent = z.infer<typeof EvidenceEvent>;

/** What to export (F-07): a project, or a date range; the save dialog picks the file. */
export const EvidenceExportInput = z.discriminatedUnion("scope", [
  z.object({ scope: z.literal("project"), project_id: z.string().uuid() }).strict(),
  z.object({ scope: z.literal("range"), from: z.string().datetime(), to: z.string().datetime() }).strict(),
]);
export type EvidenceExportInput = z.infer<typeof EvidenceExportInput>;

/** The written bundle, as the backend reports it (POST /evidence/export). */
export const EvidenceExport = z.object({
  file_name: z.string(),
  path: z.string(),
  size_bytes: z.number().int(),
  stream_id: z.string(),
  epoch_range: z.tuple([z.number().int(), z.number().int()]),
  first_seq: z.number().int(),
  last_seq: z.number().int(),
  expected_tip: z.string(),
  signer_key_ids: z.array(z.string()),
  checkpoint_ids: z.array(z.string()),
  custody: z.string(),
  exported_at: z.string(),
  scope: z.string(),
});
export type EvidenceExport = z.infer<typeof EvidenceExport>;

/** A signed checkpoint the evidence writer made over a range of events (GET /evidence/checkpoints). */
export const EvidenceCheckpoint = z.object({
  id: z.string(),
  stream_id: z.string(),
  epoch: z.number().int(),
  seq_from: z.number().int(),
  seq_to: z.number().int(),
  root_hash: z.string(),
  signer_key_id: z.string(),
  signature: z.string(),
  created_at: z.string(),
});
export type EvidenceCheckpoint = z.infer<typeof EvidenceCheckpoint>;

export const EvidenceStatus = z.object({ writer: z.enum(["ok", "unavailable"]), pending: z.number().int() });
export type EvidenceStatus = z.infer<typeof EvidenceStatus>;

/** This installation's evidence stream. Each restore starts a new epoch. */
export const EvidenceStream = z.object({
  stream_id: z.string(),
  device_id: z.string().nullable(),
  epoch: z.number().int(),
  signer_key_id: z.string(),
  prior_tip_hash: z.string().nullable(),
  created_at: z.string().nullable(),
});
export type EvidenceStream = z.infer<typeof EvidenceStream>;

/* ------------------------------------------------------------------ models */
export const Tier = z.enum(["small", "medium", "large"]);

export const CatalogueEntry = z.object({
  entry_id: z.string(),
  name: z.string(),
  tier: Tier,
  upstream_model: z.string(),
  upstream_revision: z.string(),
  source_weight_digest: z.string().nullable(),
  conversion_tool: z.string(),
  conversion_version: z.string(),
  quantisation_method: z.string(),
  artifact_digest: z.string(),
  size_bytes: z.number().int(),
  file_name: z.string(),
  licence: z.string(),
  licence_reference: z.string(),
  publisher: z.string(),
  pipeline: z.enum(["own", "third-party"]),
  deviation_approval: z
    .object({ reviewer: z.string(), date: z.string(), quality_threshold_result: z.string() })
    .nullable(),
  context_length: z.number().int(),
  min_ram_gb: z.number().int(),
  min_vram_gb: z.number().int(),
  mirror_url: z.string(),
  description: z.string(),
});
export type CatalogueEntry = z.infer<typeof CatalogueEntry>;

export const Catalogue = z.object({ version: z.string(), signed: z.boolean(), entries: z.array(CatalogueEntry) });
export type Catalogue = z.infer<typeof Catalogue>;

export const InstalledModel = z.object({
  id: z.string(),
  catalogue_entry_id: z.string(),
  name: z.string(),
  file_path: z.string(),
  artifact_digest: z.string(),
  size_bytes: z.number().int(),
  context_length: z.number().int(),
  licence: z.string(),
  tier: Tier,
  installed_at: z.string(),
  source: z.enum(["download", "offline"]),
});
export type InstalledModel = z.infer<typeof InstalledModel>;

/** A model file that came with the installer (offline package), not yet checked. */
export const PackageFile = z.object({ file_name: z.string(), size_bytes: z.number().int(), entry_id: z.string().nullable() });
export type PackageFile = z.infer<typeof PackageFile>;
/** A file name in the offline package folder: no folders, a .gguf file. */
export const PackageFileName = z.string().regex(/^[^\\/:*?"<>|]{1,250}\.gguf$/i);

export const Hardware = z.object({
  cpu: z.string(),
  cores: z.number().int(),
  ram_gb: z.number().int(),
  gpu: z.object({ name: z.string(), vram_gb: z.number().int(), driver_ok: z.boolean() }).nullable(),
  free_disk_gb: z.number().int(),
  os: z.string(),
  recommended_tier: Tier.nullable(),
  /** The one model AIOS suggests for this machine (catalogue entry id); null below the minimum. */
  recommended_entry_id: z.string().nullable().optional(),
  checked_at: z.string(),
  /** The latest benchmark on this machine; null until one has run. */
  benchmark: z
    .object({
      model_id: z.string(),
      engine: z.enum(["cpu", "vulkan"]),
      tokens_per_second: z.number(),
      time_to_first_token_ms: z.number().int(),
      run_at: z.string(),
    })
    .nullable()
    .optional(),
});
export type Hardware = z.infer<typeof Hardware>;

export const EngineStatus = z.object({
  state: z.enum([
    "not_built",
    "no_model",
    "not_started",
    "loading",
    "ready",
    "generating",
    "idle_unloaded",
    "failed",
  ]),
  installed: z.number().int(),
  build: z.enum(["cpu", "vulkan"]).nullable().optional(),
  loaded_model_id: z.string().nullable().optional(),
});
export type EngineStatus = z.infer<typeof EngineStatus>;

/** One benchmark run (POST /system/benchmark): a short answer from the local engine. */
export const BenchmarkRun = z.object({
  model_id: z.string(),
  engine: z.enum(["cpu", "vulkan"]),
  tokens_per_second: z.number(),
  time_to_first_token_ms: z.number().int(),
  run_at: z.string(),
});
export type BenchmarkRun = z.infer<typeof BenchmarkRun>;

/** A model download (GET /models/downloads): from the model's origin, resumable. */
export const DownloadState = z.object({
  entry_id: z.string(),
  status: z.enum(["queued", "downloading", "paused", "verifying", "failed", "done"]),
  received_bytes: z.number().int(),
  total_bytes: z.number().int(),
  speed_bps: z.number().int(),
  error: z.string().nullable(),
  started_at: z.string(),
});
export type DownloadState = z.infer<typeof DownloadState>;

/* ------------------------------------------------------------------ voice (ADR 0016) */
/** Whether speaking instead of typing can be used now (GET /voice/status). */
/** The speech model: on this computer, or being downloaded (setup, Settings > Voice). */
export const VoiceModel = z.object({
  status: z.enum(["missing", "downloading", "verifying", "ready", "failed"]),
  received_bytes: z.number().int(),
  total_bytes: z.number().int(),
  error: z.string().nullable(),
});
export type VoiceModel = z.infer<typeof VoiceModel>;

export const VoiceStatus = z.object({
  state: z.enum(["not_built", "no_model", "not_started", "starting", "ready", "failed"]),
  build: z.enum(["cpu", "vulkan"]).nullable(),
  model: VoiceModel,
});
export type VoiceStatus = z.infer<typeof VoiceStatus>;

export const VoiceSessionId = z.string().regex(/^[0-9a-f]{32}$/);
/** The computer's languages as the window sees them, main first: used while none are chosen. */
export const VoiceLanguages = z.array(z.string().regex(/^[a-z]{2,3}$/)).max(5);
export const VoiceSession = z.object({ session_id: VoiceSessionId });
export type VoiceSession = z.infer<typeof VoiceSession>;

/** 16 kHz, mono, 16-bit little-endian PCM from the microphone: at most 2 s per call. */
export const VOICE_MAX_AUDIO_BYTES = 64_000;
export const VoiceAudio = z
  .instanceof(Uint8Array)
  .refine((a) => a.byteLength % 2 === 0 && a.byteLength <= VOICE_MAX_AUDIO_BYTES, "voice_audio_invalid");

/** The words heard so far; `pending`: a phrase is still being turned into text. */
export const VoiceText = z.object({ text: z.string(), pending: z.boolean() });
export type VoiceText = z.infer<typeof VoiceText>;

export const VoiceFinished = z.object({ text: z.string() });
export type VoiceFinished = z.infer<typeof VoiceFinished>;

/* Recording files turned into text: the Voice notes skill, on the same speech engine. The window
 * decodes the file into the audio dictation sends and sends it in parts of up to 30 s. */
export const VOICE_MAX_RECORDING_S = 7200;
export const VOICE_MAX_RECORDING_PART_BYTES = 960_000;
export const VoiceRecordingSeconds = z.number().positive().max(VOICE_MAX_RECORDING_S);
export const VoiceRecordingPart = z
  .instanceof(Uint8Array)
  .refine((a) => a.byteLength % 2 === 0 && a.byteLength <= VOICE_MAX_RECORDING_PART_BYTES, "voice_audio_invalid");

/** Progress; the window sends the next part only while `waiting_s` is under `backlog_s`. */
export const VoiceRecording = z.object({
  recording_id: VoiceSessionId,
  state: z.enum(["working", "done", "stopped", "failed"]),
  total_s: z.number(),
  done_s: z.number(),
  waiting_s: z.number(),
  backlog_s: z.number(),
  text: z.string(),
});
export type VoiceRecording = z.infer<typeof VoiceRecording>;

/** Where the text of a recording goes; Activity records that it happened, never the text. */
export const VoiceRecordingTarget = z.object({ conversation_id: Id.optional(), project_id: Id.optional() }).strict();
export type VoiceRecordingTarget = z.infer<typeof VoiceRecordingTarget>;

/* ------------------------------------------------------------------ pictures and videos (R-7) */
/** Made on the company's GPU server; the description leaves this computer, so the UI asks first. */
export const MediaKind = z.enum(["image", "video"]);
export type MediaKind = z.infer<typeof MediaKind>;

export const MediaModel = z.object({ id: z.string(), kind: MediaKind });
export type MediaModel = z.infer<typeof MediaModel>;

/** GET /media/status. `reason` when not available, e.g. `company_provider_disabled`, `media_not_offered`. */
export const MediaStatus = z.object({
  available: z.boolean(),
  reason: z.string().nullable(),
  models: z.array(MediaModel),
});
export type MediaStatus = z.infer<typeof MediaStatus>;

export const MediaItem = z.object({
  id: z.string(),
  project_id: z.string(),
  kind: MediaKind,
  model: z.string(),
  prompt: z.string(),
  negative_prompt: z.string().nullable(),
  width: z.number().int(),
  height: z.number().int(),
  frames: z.number().int().nullable(),
  seed: z.number().int(),
  status: z.enum(["queued", "running", "done", "failed", "cancelled"]),
  /** 0 to 1. */
  progress: z.number(),
  /** Jobs ahead of this one on the server. */
  position: z.number().int().nullable(),
  error_code: z.string().nullable(),
  mime: z.string().nullable(),
  size_bytes: z.number().int().nullable(),
  created_at: z.string(),
  finished_at: z.string().nullable(),
});
export type MediaItem = z.infer<typeof MediaItem>;

/** What to make. `confirmed`: the person agreed in the dialog that the description goes to the company server. */
export const MediaCreate = z
  .object({
    kind: MediaKind,
    model: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:+-]{0,63}$/),
    prompt: z.string().min(1).max(2000),
    negative_prompt: z.string().max(1000).nullable().optional(),
    width: z.number().int().min(64).max(4096),
    height: z.number().int().min(64).max(4096),
    frames: z.number().int().min(1).max(1000).nullable().optional(),
    seed: z.number().int().min(0).max(4294967295).nullable().optional(),
    confirmed: z.boolean(),
  })
  .strict();
export type MediaCreate = z.infer<typeof MediaCreate>;

/** The finished file, to show in the window. */
export const MediaContent = z.object({
  id: z.string(),
  mime: z.enum(["image/png", "image/jpeg", "image/webp", "video/mp4", "video/webm"]),
  data_base64: z.string(),
});
export type MediaContent = z.infer<typeof MediaContent>;

export const MediaSaved = z.object({ path: z.string(), size_bytes: z.number().int() });
export type MediaSaved = z.infer<typeof MediaSaved>;

/* ------------------------------------------------------------------ bridge */
export interface AiosBridge {
  system: {
    health(): Promise<Health>;
    status(): Promise<SystemStatus>;
    info(): Promise<SystemInfo>;
    /** System save dialog, then the backend zips the log folder there. Null when cancelled. */
    supportBundle(): Promise<SupportBundle | null>;
    /** Asks the user in a system dialog, then opens a web link in the default browser. True when opened. */
    openLink(url: string): Promise<boolean>;
  };
  setup: {
    status(): Promise<SetupStatus>;
    /** Create the store and the Recovery Package. Fails with `store_exists` the second time. */
    createStore(): Promise<StoreCreated>;
    complete(): Promise<Completed>;
    /** System folder dialog; null when cancelled. */
    chooseBackupFolder(): Promise<BackupFolder | null>;
    /** System folder dialog for where backups go; null when cancelled. */
    chooseBackupLocation(): Promise<string | null>;
    /** PUT /backup/location: an existing folder, or null for "Set up later". */
    setBackupLocation(path: string | null): Promise<SetupStatus>;
    /** POST /backup: back up now to the chosen location. */
    backup(): Promise<BackupResult>;
    /** POST /recovery-key: the keys are wrapped again under a new recovery key, returned once. */
    newRecoveryKey(): Promise<NewRecoveryKey>;
    restore(input: RestoreInput): Promise<Restored>;
  };
  settings: {
    get(): Promise<Settings>;
    update(patch: SettingsPatch): Promise<Settings>;
    network(): Promise<AllowlistEntry[]>;
    /** Runs the signed update feed check in main and records the result (a manual check). */
    checkForUpdates(): Promise<Settings>;
    /** Asks the model mirror which catalogue it offers (a manual check). */
    checkCatalogue(): Promise<CatalogueCheck>;
  };
  projects: {
    list(): Promise<Project[]>;
    create(input: ProjectCreate): Promise<Project>;
    update(id: string, patch: ProjectPatch): Promise<Project>;
    remove(id: string): Promise<void>;
    reclassify(id: string, to: Classification): Promise<Reclassified>;
    setCompanyAi(id: string, enabled: boolean, confirmed: boolean): Promise<Project>;
    /** System save dialog, then the backend writes the package. Null when cancelled. */
    exportPackage(id: string, input: ExportPackageInput): Promise<PackageExport | null>;
    /** System open dialog for a .aiosproj file; null when cancelled. */
    choosePackage(): Promise<PickedFile | null>;
    importPackage(path: string): Promise<PackageImport>;
  };
  conversations: {
    list(projectId: string): Promise<Conversation[]>;
    create(projectId: string, title?: string): Promise<Conversation>;
    update(id: string, patch: ConversationPatch): Promise<Conversation>;
    remove(id: string): Promise<void>;
    setProvider(id: string, to: Provider, confirmed: boolean): Promise<Conversation>;
    messages(id: string): Promise<Message[]>;
    /** `knowledgeIds`: documents from My secure knowledge whose text goes with the question. */
    send(id: string, text: string, knowledgeIds?: string[]): Promise<Exchange>;
    regenerate(id: string): Promise<Exchange>;
    /** GET /conversations/{id}/generation: answering now, its phase and the answer so far. */
    generation(id: string): Promise<GenerationState>;
    /** POST /conversations/{id}/stop: end the answer; the words so far are kept. */
    stop(id: string): Promise<Message>;
    /** GET /conversations/{id}/summary: the earlier part of a long conversation, or null. */
    summary(id: string): Promise<ConversationSummary | null>;
    providers(): Promise<ProvidersStatus>;
  };
  search: {
    query(q: string): Promise<SearchHit[]>;
  };
  /** Add skills to my AI. */
  skills: {
    list(): Promise<Skills>;
    install(id: string): Promise<InstalledSkill>;
    setEnabled(id: string, enabled: boolean): Promise<InstalledSkill>;
    remove(id: string): Promise<void>;
    /** System open dialog for a .aios-skill file; null when cancelled. */
    chooseFile(): Promise<string | null>;
    /** What the file holds; adds nothing. */
    checkFile(path: string): Promise<SkillFileCheck>;
    installFile(path: string): Promise<InstalledSkill>;
  };
  /** My secure knowledge: documents copied into the encrypted store and read so the AI can use them. */
  knowledge: {
    list(): Promise<KnowledgeDoc[]>;
    /** System open dialog (several files); null when cancelled. */
    chooseFiles(): Promise<string[] | null>;
    /** System folder dialog; null when cancelled. */
    chooseFolder(): Promise<string | null>;
    addFiles(paths: string[], collection?: string): Promise<KnowledgeDoc[]>;
    /** What adding the folder would copy; adds nothing. */
    previewFolder(path: string): Promise<FolderPreview>;
    /** Every file in the folder and its subfolders, as one collection named after the folder. */
    addFolder(path: string): Promise<KnowledgeDoc[]>;
    /** Read the encrypted copy again. */
    retry(id: string): Promise<KnowledgeDoc>;
    /** Removes the copy only; the original file is never touched. */
    remove(id: string): Promise<void>;
    /** Where a file dropped on the page is on this computer ("" when it is not a file there). */
    pathOf(file: object): string;
  };
  evidence: {
    list(projectId?: string): Promise<EvidenceEvent[]>;
    status(): Promise<EvidenceStatus>;
    stream(): Promise<EvidenceStream>;
    /** Signed checkpoints, oldest first; empty until the writer has made one. */
    checkpoints(): Promise<EvidenceCheckpoint[]>;
    /** System save dialog, then the evidence writer builds and signs the bundle. Null when cancelled. */
    export(input: EvidenceExportInput): Promise<EvidenceExport | null>;
  };
  models: {
    catalogue(): Promise<Catalogue>;
    installed(): Promise<InstalledModel[]>;
    /** System open dialog for a .gguf file; null when cancelled. */
    chooseFile(): Promise<PickedFile | null>;
    importFile(path: string, entryId: string | null): Promise<InstalledModel>;
    /** Model files that came with the installer (offline package), waiting to be checked. */
    packageFiles(): Promise<PackageFile[]>;
    /** Checks one of them like an import and installs it; a file that fails is deleted. */
    installPackageFile(fileName: string): Promise<InstalledModel>;
    download(entryId: string): Promise<void>;
    /** Downloads in progress, paused, failed or just finished. */
    downloads(): Promise<DownloadState[]>;
    pauseDownload(entryId: string): Promise<DownloadState>;
    resumeDownload(entryId: string): Promise<DownloadState>;
    /** Stops the download and deletes what was received. */
    cancelDownload(entryId: string): Promise<void>;
    remove(id: string): Promise<void>;
    hardware(refresh: boolean): Promise<Hardware>;
    engine(): Promise<EngineStatus>;
    /** Starts the engine with the default model if needed and times a short answer. */
    benchmark(): Promise<BenchmarkRun>;
  };
  /** Speak instead of typing: turned into text on this computer (ADR 0016). */
  voice: {
    status(): Promise<VoiceStatus>;
    /** Downloads the speech model unless it is here or on its way (setup, Settings > Voice). */
    downloadModel(): Promise<VoiceStatus>;
    /**
     * Starts the speech engine if needed. `languages`: the computer's, used while none are chosen
     * in Settings. Fails with `voice_not_built`, `voice_no_model` or `voice_failed`.
     */
    start(languages?: string[]): Promise<VoiceSession>;
    /** About 250 ms of audio; returns at once with the words so far. */
    audio(sessionId: string, pcm: Uint8Array): Promise<VoiceText>;
    /** Turns the rest into text and returns all of it. */
    finish(sessionId: string): Promise<VoiceFinished>;
    /** Throws away what was heard. */
    cancel(sessionId: string): Promise<void>;
    /** Turning a recording into text (the Voice notes skill): fails with `skill_not_enabled` while it is off. */
    recordingStart(seconds: number, languages?: string[]): Promise<VoiceRecording>;
    /** The next part of the decoded recording, up to 30 s; returns at once with the progress. */
    recordingAudio(recordingId: string, pcm: Uint8Array): Promise<VoiceRecording>;
    /** All of it has been sent. */
    recordingEnd(recordingId: string): Promise<VoiceRecording>;
    recordingProgress(recordingId: string): Promise<VoiceRecording>;
    /** Stops; the text written so far is kept. */
    recordingStop(recordingId: string): Promise<VoiceRecording>;
    /** The text, once done or stopped; the job ends and Activity records where it went. */
    recordingTake(recordingId: string, target: VoiceRecordingTarget): Promise<VoiceFinished>;
    /** Throws the text away. */
    recordingDiscard(recordingId: string): Promise<void>;
  };
  /** Pictures and short videos made on the company's GPU server (R-7), kept per project. */
  media: {
    status(): Promise<MediaStatus>;
    /** Newest first; jobs still running are checked with the server. */
    list(projectId: string): Promise<MediaItem[]>;
    /** Fails with `confirmation_required` unless confirmed (or the project uses the company server). */
    create(projectId: string, input: MediaCreate): Promise<MediaItem>;
    get(id: string): Promise<MediaItem>;
    content(id: string): Promise<MediaContent>;
    cancel(id: string): Promise<MediaItem>;
    /** System save dialog, then the backend writes a copy there. Null when cancelled. */
    save(id: string): Promise<MediaSaved | null>;
    remove(id: string): Promise<void>;
  };
}

/** IPC channel names; main registers exactly these. */
export const Channels = {
  invoke: "aios:invoke",
} as const;

/**
 * The error code of a failed bridge call: the backend's `{"error": code}`, or `backend_<status>`.
 * Electron wraps errors thrown in main ("Error invoking remote method …: Error: store_exists"),
 * so the code is the last word of the message.
 */
export function errorCode(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return /([a-z][a-z0-9_]*)\s*$/.exec(message)?.[1] ?? "unknown_error";
}
