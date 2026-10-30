import type { EngineBuild, InstalledModelRef, ModelTier } from "@/lib/types";

/** One entry of the signed Model Catalogue v1 (MVP 9.6). */
export interface CatalogueEntry {
  entry_id: string;
  name: string;
  tier: ModelTier;
  upstream_model: string;
  upstream_revision: string;
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
  deviation_approval?: { reviewer: string; date: string; quality_threshold_result: string };
  context_length: number;
  min_ram_gb: number;
  min_vram_gb: number;
}

export interface Hardware {
  cpu: string;
  cores: number;
  ram_gb: number;
  gpu?: { name: string; vram_gb: number; driver_ok: boolean };
  free_disk_gb: number;
  os: string;
}

export type DownloadStatus = "queued" | "downloading" | "paused" | "verifying" | "failed" | "done";

export interface DownloadState {
  entry_id: string;
  status: DownloadStatus;
  received_bytes: number;
  total_bytes: number;
  speed_bps: number;
  error?: string;
}

export type ModelSource = "mirror" | "offline";

export interface Benchmark {
  engine: EngineBuild;
  tokens_per_second: number;
  time_to_first_token_ms: number;
}

/** What the wizard hands back to the app when the user opens AIOS. */
export interface FirstRunResult {
  installedModel: InstalledModelRef | null;
}
