import type { CatalogueEntry, Hardware } from "@/lib/types";

/**
 * Model Catalogue v1 (MVP 9.6): the same entries as the backend's catalogue_dev.json (a backend
 * test checks). Real published files with their real size and SHA-256; only the mirror host is a
 * placeholder until B-06.
 */
export const CATALOGUE: CatalogueEntry[] = [
  {
    entry_id: "ornith-1.5-9b-q4_k_m-ornith-gguf",
    name: "Ornith 1.5 9B",
    tier: "medium",
    upstream_model: "ornith-ai/Ornith-1.5-9B-GGUF",
    upstream_revision: "abdd624b12ebf020b767fff532ff44fe552b28c3",
    source_weight_digest: null,
    conversion_tool: "llama.cpp (as published upstream; exact build not stated)",
    conversion_version: "unknown — not stated in upstream repo",
    quantisation_method: "Q4_K_M",
    artifact_digest: "70c112196e0b7023803c9762752e46d29e612a92c83f995bc3ba1ceb07e8fab6",
    size_bytes: 5_780_090_816,
    file_name: "Ornith-1.5-9B-Q4_K_M.gguf",
    licence: "MIT",
    licence_reference: "licenses/models/Ornith-1.5-9B-GGUF-LICENSE.txt",
    publisher: "Ornith AI (official GGUF)",
    pipeline: "third-party",
    deviation_approval: {
      reviewer: "Andrea Rossetti",
      date: "2026-11-10",
      quality_threshold_result: "pass",
    },
    context_length: 32_768,
    min_ram_gb: 16,
    min_vram_gb: 8,
    mirror_url: "https://models.example.eu/v1/Ornith-1.5-9B-Q4_K_M.gguf",
    description: "Good quality for drafting, summarising and reasoning. Fits fully on a GPU with 8 GB.",
  },
  {
    entry_id: "minicpm5-2b-q4_k_m-openbmb-gguf",
    name: "MiniCPM5 2B",
    tier: "small",
    upstream_model: "openbmb/MiniCPM5-2B-GGUF",
    upstream_revision: "2079a22f3beaa4e306449978533478fe0522f4b3",
    source_weight_digest: null,
    conversion_tool: "llama.cpp (as published upstream; exact build not stated)",
    conversion_version: "unknown — not stated in upstream repo",
    quantisation_method: "Q4_K_M",
    artifact_digest: "ec2d5801640099e97d8d7e8003ad4d81f336e757811f03a26173dddf386602fd",
    size_bytes: 1_561_318_368,
    file_name: "MiniCPM5-2B-Q4_K_M.gguf",
    licence: "Apache-2.0",
    licence_reference: "licenses/models/MiniCPM5-2B-GGUF-LICENSE.txt",
    publisher: "OpenBMB (official GGUF)",
    pipeline: "third-party",
    deviation_approval: {
      reviewer: "Andrea Rossetti",
      date: "2026-11-06",
      quality_threshold_result: "pass",
    },
    context_length: 32_768,
    min_ram_gb: 8,
    min_vram_gb: 0,
    mirror_url: "https://models.example.eu/v1/MiniCPM5-2B-Q4_K_M.gguf",
    description: "Runs on 8 GB machines without a GPU: about 15 words per second on a 4-core CPU.",
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
