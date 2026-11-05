/**
 * Data model for the AIOS MVP prototype.
 * Mirrors MVP specification sections 9.1 (chats.db), 9.2 (Evidence Wire Format v1),
 * 9.4 (Recovery Package v1), 9.5 (Project Package v1) and 9.6 (Model Catalogue v1).
 * Field names follow the specification so the prototype maps onto the real schema.
 */

export type Classification = "restricted" | "internal" | "public";
export type ClassificationSource = "project" | "import" | "review";
export type ProviderType = "local" | "company";
export type MessageRole = "user" | "assistant";
export type MessageStatus = "complete" | "partial" | "error" | "stopped" | "streaming";
export type ModelTier = "small" | "medium";
export type EngineBuild = "cpu" | "vulkan";

export interface Project {
  id: string;
  name: string;
  classification: Classification;
  classification_source: ClassificationSource;
  /** Set on a reviewed lower-class copy; points at the original project. */
  derived_from_project_id?: string | undefined;
  /** "Use Company AI for new conversations in this project". Only meaningful while the provider flag is on. */
  company_ai_enabled: boolean;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface Conversation {
  id: string;
  project_id: string;
  title: string;
  classification_effective: Classification;
  classification_source: ClassificationSource;
  provider_mode: ProviderType;
  current_provider: ProviderType;
  model_id: string | null;
  archived: boolean;
  created_at: string;
  updated_at: string;
  /** Preview text for lists. */
  last_message_preview?: string | undefined;
  /** Points where the conversation moved between providers; drawn as dividers. */
  moves?: ProviderDivider[] | undefined;
}

export interface ProviderDivider {
  to: ProviderType;
  at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: MessageRole;
  content: string;
  classification_effective: Classification;
  classification_source: ClassificationSource;
  status: MessageStatus;
  provider: ProviderType;
  model_id: string | null;
  prompt_tokens: number;
  completion_tokens: number;
  created_at: string;
  /** The evidence event has not been acknowledged by the writer yet (outbox replay pending). */
  evidence_pending?: boolean | undefined;
  /** Sequence number of the request event once acknowledged. */
  evidence_seq?: number | undefined;
  /** A provider divider is drawn above this message. */
  divider_before?: ProviderDivider | undefined;
  /** Previous answer versions kept after regenerate (assumption A-03). */
  previous_versions?: string[] | undefined;
  /** True while "Preparing context" is shown for this answer. */
  preparing?: boolean | undefined;
  /** Local continuation was offered for this partial answer. */
  continuation_offered?: boolean | undefined;
  /** This answer continues a partial answer locally; points at the partial message. */
  continued_from?: string | undefined;
}

export interface Summary {
  id: string;
  conversation_id: string;
  covers_until_message_id: string;
  content: string;
  classification_effective: Classification;
  classification_source: ClassificationSource;
  model_id: string;
  provider: ProviderType;
  created_at: string;
}

export interface DeviationApproval {
  reviewer: string;
  date: string;
  quality_threshold_result: string;
}

export interface CatalogueEntry {
  entry_id: string;
  name: string;
  tier: ModelTier;
  upstream_model: string;
  upstream_revision: string;
  source_weight_digest: string;
  conversion_tool: string;
  conversion_version: string;
  quantisation_method: string;
  artifact_digest: string;
  size_bytes: number;
  file_name: string;
  licence: string;
  licence_reference: string;
  publisher: string;
  pipeline: "own" | "third-party";
  deviation_approval?: DeviationApproval | undefined;
  context_length: number;
  min_ram_gb: number;
  min_vram_gb: number;
  mirror_url: string;
  /** Short human description shown in the model manager. */
  description: string;
}

export interface InstalledModel {
  id: string;
  catalogue_entry_id: string;
  name: string;
  file_path: string;
  artifact_digest: string;
  size_bytes: number;
  context_length: number;
  licence: string;
  tier: ModelTier;
  installed_at: string;
  source: "download" | "offline";
}

export type DownloadStatus = "queued" | "downloading" | "paused" | "verifying" | "failed" | "done";

export interface DownloadState {
  entry_id: string;
  status: DownloadStatus;
  received_bytes: number;
  total_bytes: number;
  speed_bps: number;
  error?: string | undefined;
  started_at: string;
}

export interface Benchmark {
  model_id: string;
  engine: EngineBuild;
  tokens_per_second: number;
  time_to_first_token_ms: number;
  run_at: string;
}

export interface Hardware {
  cpu: string;
  cores: number;
  ram_gb: number;
  gpu?: { name: string; vram_gb: number; driver_ok: boolean };
  free_disk_gb: number;
  os: string;
  recommended_tier: ModelTier | null;
  benchmark?: Benchmark | undefined;
}

export type EventType =
  | "install"
  | "store_created"
  | "recovery_package_written"
  | "recovery_key_issued"
  | "model_installed"
  | "model_deleted"
  | "project_created"
  | "project_reclassified"
  | "project_deleted"
  | "conversation_created"
  | "conversation_deleted"
  | "disclosure_confirmed"
  | "request"
  | "provider_changed"
  | "export"
  | "import"
  | "restore"
  | "continuation"
  | "key_rotation"
  | "refusal"
  | "shutdown";

export interface EvidenceEvent {
  seq: number;
  format_version: 1;
  stream_id: string;
  epoch: number;
  ts: string;
  event_type: EventType;
  actor: "user" | "app" | "operator";
  project_id?: string | undefined;
  conversation_id?: string | undefined;
  provider?: ProviderType | undefined;
  model_digest?: string | undefined;
  input_commitment?: string | undefined;
  output_commitment?: string | undefined;
  prev_hash: string;
  event_hash: string;
  /** Per-type payload. Never content. */
  payload?: Record<string, string | number | boolean | null> | undefined;
  /** Still in the outbox, awaiting the writer's acknowledgement. */
  pending?: boolean | undefined;
}

export interface Checkpoint {
  id: string;
  stream_id: string;
  epoch: number;
  seq_from: number;
  seq_to: number;
  root_hash: string;
  signer_key_id: string;
  signature: string;
  created_at: string;
}

export interface EvidenceStream {
  stream_id: string;
  device_id: string;
  epoch: number;
  signer_key_id: string;
  prior_tip_hash?: string | undefined;
  created_at: string;
}

export interface AllowlistEntry {
  host: string;
  purpose: string;
  kind: "fixed" | "configured";
  enabled: boolean;
}

export interface Settings {
  update_check: boolean;
  catalogue_check: boolean;
  safe_mode_cpu: boolean;
  default_model_id: string | null;
  last_update_check: string | null;
  last_catalogue_check: string | null;
  update_available: { version: string; size_bytes: number } | null;
  app_version: string;
  catalogue_version: string;
  schema_version: number;
}

export type EngineState = "not_started" | "no_model" | "loading" | "ready" | "generating" | "idle_unloaded" | "failed";

export interface Health {
  backend: "ok" | "starting" | "down";
  engine: EngineState;
  engine_build: EngineBuild;
  loaded_model_id: string | null;
  writer: "ok" | "unavailable";
  evidence_pending: number;
  company: { enabled: boolean; reachable: boolean; base_url: string; model_name: string };
}

export interface SearchHit {
  message_id: string;
  conversation_id: string;
  project_id: string;
  snippet: string;
  created_at: string;
  role: MessageRole;
}

export interface ExportResult {
  file_name: string;
  size_bytes: number;
  path: string;
  checksum: string;
  /** Null until the evidence writer has appended the export event. */
  evidence_seq: number | null;
}

export interface ImportResult {
  project_id: string;
  project_name: string;
  conversations: number;
  messages: number;
  summaries: number;
  warnings: string[];
  remapped: boolean;
}

export interface EvidenceExportResult {
  file_name: string;
  path: string;
  size_bytes: number;
  stream_id: string;
  epoch_range: [number, number];
  first_seq: number;
  last_seq: number;
  expected_tip: string;
  signer_key_ids: string[];
  checkpoint_ids: string[];
  custody: string;
  exported_at: string;
  scope: string;
}

export type ToastKind = "info" | "success" | "caution" | "deny";

export interface Toast {
  id: string;
  kind: ToastKind;
  title: string;
  description?: string | undefined;
  action?: { label: string; href?: string | undefined; onClick?: (() => void) | undefined };
  duration?: number | undefined;
}

export type GenerationPhase = "loading_engine" | "preparing" | "streaming";

export interface Generation {
  conversation_id: string;
  message_id: string;
  phase: GenerationPhase;
  provider: ProviderType;
}
