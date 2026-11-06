import type { CatalogueEntry, Hardware } from "@/lib/types";

/**
 * Model Catalogue v1 (MVP 9.6). Synthetic entries shaped like the real file.
 * Only licences that allow commercial redistribution appear (Apache-2.0).
 * Digests are placeholders with the right length, not real artefact hashes.
 */
export const CATALOGUE: CatalogueEntry[] = [
  {
    entry_id: "qwen3-8b-q4km",
    name: "Qwen3 8B",
    tier: "medium",
    upstream_model: "Qwen/Qwen3-8B",
    upstream_revision: "a1b2c3d4",
    source_weight_digest: "4c1f6a9e2b7d3e8f0a5c6b1d9e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f",
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
    mirror_url: "https://models.aios.eu.com/v1/qwen3-8b-q4_k_m.gguf",
    description: "Good quality for drafting, summarising and reasoning. Fast on a GPU with 8 GB or more.",
  },
  {
    entry_id: "qwen3-4b-q4km",
    name: "Qwen3 4B",
    tier: "small",
    upstream_model: "Qwen/Qwen3-4B",
    upstream_revision: "e5f6a7b8",
    source_weight_digest: "7a3c5e9f1b2d4f6a8c0e2b4d6f8a0c2e4b6d8f0a2c4e6b8d0f2a4c6e8b0d2f4a",
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
    mirror_url: "https://models.aios.eu.com/v1/qwen3-4b-q4_k_m.gguf",
    description: "Runs on 8 GB machines without a GPU. Usable speed on a modern CPU.",
  },
  {
    entry_id: "gemma4-e4b-q4km",
    name: "Gemma 4 E4B",
    tier: "small",
    upstream_model: "google/gemma-4-e4b-it",
    upstream_revision: "0c9d8e7f",
    source_weight_digest: "5d7f9b1d3f5a7c9e1b3d5f7a9c1e3b5d7f9a1c3e5b7d9f1a3c5e7b9d1f3a5c7e",
    conversion_tool: "llama.cpp convert_hf_to_gguf + llama-quantize",
    conversion_version: "b6471",
    quantisation_method: "Q4_K_M",
    artifact_digest: "8c0e2a4c6e8b0d2f4a6c8e0b2d4f6a8c0e2b4d6f8a0c2e4b6d8f0a2c4e6b8d0f",
    size_bytes: 2_980_000_000,
    file_name: "gemma4-e4b-q4_k_m.gguf",
    licence: "Apache-2.0",
    licence_reference: "licences/gemma4-apache-2.0.txt",
    publisher: "AIOS (own quantisation)",
    pipeline: "own",
    context_length: 32_768,
    min_ram_gb: 8,
    min_vram_gb: 0,
    mirror_url: "https://models.aios.eu.com/v1/gemma4-e4b-q4_k_m.gguf",
    description: "Compact alternative for 8 GB machines. Strong at short answers and rewriting.",
  },
  {
    entry_id: "gemma4-12b-q4km",
    name: "Gemma 4 12B",
    tier: "medium",
    upstream_model: "google/gemma-4-12b-it",
    upstream_revision: "3b2a1c0d",
    source_weight_digest: "1e3b5d7f9a1c3e5b7d9f1a3c5e7b9d1f3a5c7e9b1d3f5a7c9e1b3d5f7a9c1e3b",
    conversion_tool: "llama.cpp llama-quantize (third-party artefact)",
    conversion_version: "b6402",
    quantisation_method: "Q4_K_M",
    artifact_digest: "6a8c0e2b4d6f8a0c2e4b6d8f0a2c4e6b8d0f2a4c6e8b0d2f4a6c8e0b2d4f6a8c",
    size_bytes: 7_340_000_000,
    file_name: "gemma4-12b-q4_k_m.gguf",
    licence: "Apache-2.0",
    licence_reference: "licences/gemma4-apache-2.0.txt",
    publisher: "Community quantisation (reviewed)",
    pipeline: "third-party",
    deviation_approval: {
      reviewer: "Technical reviewer",
      date: "2026-09-30",
      quality_threshold_result: "Passed: perplexity within 1.5% of own-pipeline reference",
    },
    context_length: 32_768,
    min_ram_gb: 16,
    min_vram_gb: 10,
    mirror_url: "https://models.aios.eu.com/v1/gemma4-12b-q4_k_m.gguf",
    description: "Largest option in the catalogue. Needs a GPU with 10 GB or more for comfortable speed.",
  },
];

export const DEFAULT_HARDWARE: Hardware = {
  cpu: "Intel Core i7-13700H",
  cores: 14,
  ram_gb: 16,
  gpu: { name: "NVIDIA GeForce RTX 4060 Laptop", vram_gb: 8, driver_ok: true },
  free_disk_gb: 184,
  os: "Windows 11 Pro 24H2 (build 26100)",
  recommended_tier: "medium",
};

export const MINIMUM_PROFILE = { ram_gb: 8, free_disk_gb: 10 };

export function catalogueEntry(id: string | null | undefined): CatalogueEntry | undefined {
  return CATALOGUE.find((e) => e.entry_id === id);
}

export function tierFor(hw: Hardware): "medium" | "small" | null {
  if (hw.ram_gb < MINIMUM_PROFILE.ram_gb || hw.free_disk_gb < MINIMUM_PROFILE.free_disk_gb) return null;
  if (hw.ram_gb >= 16 || (hw.gpu && hw.gpu.vram_gb >= 8)) return "medium";
  return "small";
}

export function hardwareSupports(entry: CatalogueEntry, hw: Hardware): boolean {
  if (hw.free_disk_gb * 1024 ** 3 < entry.size_bytes + 2 * 1024 ** 3) return false;
  if (hw.ram_gb >= entry.min_ram_gb) return true;
  return !!hw.gpu && hw.gpu.vram_gb >= entry.min_vram_gb && entry.min_vram_gb > 0;
}
