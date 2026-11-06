/**
 * The window.aios bridge: the renderer's only door to the system.
 * Main validates every call against these schemas before it reaches the backend.
 * Add a feature here first, then in main (ipc/) and preload, then in the UI.
 *
 * Shapes mirror the backend schemas (contracts/local-api/openapi.json). Times are ISO 8601 strings.
 */
import { z } from "zod";

/* ------------------------------------------------------------------ system */
export const Health = z.object({
  backend: z.string(),
  database: z.enum(["ok", "locked", "error"]),
  version: z.string(),
});
export type Health = z.infer<typeof Health>;

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

/** A folder the user picked in the system dialog, with what main found in it. */
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

export const EvidenceStatus = z.object({ writer: z.enum(["ok", "unavailable"]), pending: z.number().int() });
export type EvidenceStatus = z.infer<typeof EvidenceStatus>;

/* ------------------------------------------------------------------ models */
export const Tier = z.enum(["small", "medium"]);

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

export const Hardware = z.object({
  cpu: z.string(),
  cores: z.number().int(),
  ram_gb: z.number().int(),
  gpu: z.object({ name: z.string(), vram_gb: z.number().int(), driver_ok: z.boolean() }).nullable(),
  free_disk_gb: z.number().int(),
  os: z.string(),
  recommended_tier: Tier.nullable(),
  checked_at: z.string(),
});
export type Hardware = z.infer<typeof Hardware>;

export const EngineStatus = z.object({ state: z.enum(["not_built", "no_model"]), installed: z.number().int() });
export type EngineStatus = z.infer<typeof EngineStatus>;

/* ------------------------------------------------------------------ bridge */
export interface AiosBridge {
  system: {
    health(): Promise<Health>;
  };
  setup: {
    status(): Promise<SetupStatus>;
    /** Create the store and the Recovery Package. Fails with `store_exists` the second time. */
    createStore(): Promise<StoreCreated>;
    complete(): Promise<Completed>;
    /** System folder dialog; null when cancelled. */
    chooseBackupFolder(): Promise<BackupFolder | null>;
    restore(input: RestoreInput): Promise<Restored>;
  };
  settings: {
    get(): Promise<Settings>;
    update(patch: SettingsPatch): Promise<Settings>;
    network(): Promise<AllowlistEntry[]>;
    /** Runs the signed update feed check in main and records the result. */
    checkForUpdates(): Promise<Settings>;
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
    send(id: string, text: string): Promise<Exchange>;
    regenerate(id: string): Promise<Exchange>;
    providers(): Promise<ProvidersStatus>;
  };
  search: {
    query(q: string): Promise<SearchHit[]>;
  };
  evidence: {
    list(projectId?: string): Promise<EvidenceEvent[]>;
    status(): Promise<EvidenceStatus>;
    export(): Promise<void>;
  };
  models: {
    catalogue(): Promise<Catalogue>;
    installed(): Promise<InstalledModel[]>;
    /** System open dialog for a .gguf file; null when cancelled. */
    chooseFile(): Promise<PickedFile | null>;
    importFile(path: string, entryId: string | null): Promise<InstalledModel>;
    download(entryId: string): Promise<void>;
    remove(id: string): Promise<void>;
    hardware(refresh: boolean): Promise<Hardware>;
    engine(): Promise<EngineStatus>;
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
