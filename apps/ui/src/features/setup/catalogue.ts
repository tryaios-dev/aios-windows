import type { ModelTier } from "@/lib/types";
import type { CatalogueEntry, Hardware } from "./types";

/**
 * Placeholder data until the catalogue and hardware probe are on the bridge.
 * Entries are shaped like the signed Model Catalogue v1 (MVP 9.6); digests are
 * the right length but not real artefact hashes.
 */
export const CATALOGUE: CatalogueEntry[] = [
  {
    entry_id: "qwen3-8b-q4km",
    name: "Qwen3 8B",
    tier: "medium",
    upstream_model: "Qwen/Qwen3-8B",
    upstream_revision: "a1b2c3d4",
    conversion_tool: "llama.cpp convert_hf_to_gguf + llama-quantize",
    conversion_version: "b6471",
    quantisation_method: "Q4_K_M",
    artifact_digest: "9f2d7c1e4b6a8d0f3e5c7a9b1d3f5e7c9a1b3d5f7e9c1a3b5d7f9e1c3a5b7d9f",
    size_bytes: 5_260_000_000,
    file_name: "qwen3-8b-q4_k_m.gguf",
    licence: "Apache-2.0",
    licence_reference: "licences/qwen3-apache-2.0.txt",
    publisher: "AIOS (own quantisation)",
    pipeline: "own",
    context_length: 32_768,
    min_ram_gb: 16,
    min_vram_gb: 8,
  },
  {
    entry_id: "qwen3-4b-q4km",
    name: "Qwen3 4B",
    tier: "small",
    upstream_model: "Qwen/Qwen3-4B",
    upstream_revision: "e5f6a7b8",
    conversion_tool: "llama.cpp convert_hf_to_gguf + llama-quantize",
    conversion_version: "b6471",
    quantisation_method: "Q4_K_M",
    artifact_digest: "2b8e4d6f0a1c3e5b7d9f1a3c5e7b9d1f3a5c7e9b1d3f5a7c9e1b3d5f7a9c1e3b",
    size_bytes: 2_560_000_000,
    file_name: "qwen3-4b-q4_k_m.gguf",
    licence: "Apache-2.0",
    licence_reference: "licences/qwen3-apache-2.0.txt",
    publisher: "AIOS (own quantisation)",
    pipeline: "own",
    context_length: 32_768,
    min_ram_gb: 8,
    min_vram_gb: 0,
  },
];

export const SAMPLE_HARDWARE: Hardware = {
  cpu: "Intel Core i7-13700H",
  cores: 14,
  ram_gb: 16,
  gpu: { name: "NVIDIA GeForce RTX 4060 Laptop", vram_gb: 8, driver_ok: true },
  free_disk_gb: 184,
  os: "Windows 11 Pro 24H2 (build 26100)",
};

export const MINIMUM_PROFILE = { ram_gb: 8, free_disk_gb: 10 };

/** Free disk a model needs on top of its own size while it installs. */
export const WORKING_SPACE_BYTES = 2 * 1024 ** 3;

/** Default catalogue entry per tier (MVP 4.1: Medium → Qwen3 8B, Small → Qwen3 4B). */
export const TIER_ENTRY: Record<ModelTier, string> = { small: "qwen3-4b-q4km", medium: "qwen3-8b-q4km" };

export const TIER_LABEL: Record<ModelTier, string> = { small: "Small", medium: "Medium" };

export const TIER_EXPECTATION: Record<ModelTier, string> = {
  small: "Usable; roughly 5 to 15 words per second on a modern CPU",
  medium: "Good quality; fast on a GPU",
};

export function catalogueEntry(id: string | null | undefined): CatalogueEntry | undefined {
  return CATALOGUE.find((e) => e.entry_id === id);
}

export function entryForTier(tier: ModelTier): CatalogueEntry {
  const entry = catalogueEntry(TIER_ENTRY[tier]);
  if (!entry) throw new Error(`No catalogue entry for tier ${tier}`);
  return entry;
}

/** Recommended tier for this machine, or null when it is below the minimum. */
export function tierFor(hw: Hardware): ModelTier | null {
  if (hw.ram_gb < MINIMUM_PROFILE.ram_gb || hw.free_disk_gb < MINIMUM_PROFILE.free_disk_gb) return null;
  if (hw.ram_gb >= 16 || (hw.gpu && hw.gpu.vram_gb >= 8)) return "medium";
  return "small";
}

export function hardwareSupports(entry: CatalogueEntry, hw: Hardware): boolean {
  if (hw.free_disk_gb * 1024 ** 3 < entry.size_bytes + WORKING_SPACE_BYTES) return false;
  if (hw.ram_gb >= entry.min_ram_gb) return true;
  return !!hw.gpu && entry.min_vram_gb > 0 && hw.gpu.vram_gb >= entry.min_vram_gb;
}
