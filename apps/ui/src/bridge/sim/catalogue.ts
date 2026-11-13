import type { CatalogueEntry, Hardware } from "@/lib/types";

/**
 * Model Catalogue v1 (MVP 9.6): the same entries as the backend's catalogue_dev.json (a backend
 * test checks). Real published files with their real size and SHA-256, downloaded from their
 * origin on Hugging Face at a pinned revision. Entries without a passed review are listed but never
 * suggested or installed.
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
    mirror_url: "https://huggingface.co/ornith-ai/Ornith-1.5-9B-GGUF/resolve/abdd624b12ebf020b767fff532ff44fe552b28c3/Ornith-1.5-9B-Q4_K_M.gguf",
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
    mirror_url: "https://huggingface.co/openbmb/MiniCPM5-2B-GGUF/resolve/2079a22f3beaa4e306449978533478fe0522f4b3/MiniCPM5-2B-Q4_K_M.gguf",
    description: "Runs on 8 GB machines without a GPU: about 15 words per second on a 4-core CPU.",
  },
  {
    entry_id: "sage-a1.5-q4_k_m-mradermacher-gguf",
    name: "Sage A1.5",
    tier: "large",
    upstream_model: "mradermacher/Sage-A1.5-GGUF",
    upstream_revision: "fedd56b69117f706f48d0ac4ec565e9211d4407d",
    source_weight_digest: null,
    conversion_tool: "llama.cpp (as published upstream; exact build not stated)",
    conversion_version: "unknown — not stated in upstream repo",
    quantisation_method: "Q4_K_M",
    artifact_digest: "43ff9ee24508e58c1bdebb1987dffa14e86d77a3d916eb2c33eeba3757ddad9d",
    size_bytes: 21_713_464_320,
    file_name: "Sage-A1.5.Q4_K_M.gguf",
    licence: "Apache-2.0",
    licence_reference: "licenses/models/Sage-A1.5-GGUF-LICENSE.txt",
    publisher: "mradermacher (community GGUF of InternScience/Sage-A1.5)",
    pipeline: "third-party",
    context_length: 32_768,
    min_ram_gb: 32,
    min_vram_gb: 8,
    mirror_url: "https://huggingface.co/mradermacher/Sage-A1.5-GGUF/resolve/fedd56b69117f706f48d0ac4ec565e9211d4407d/Sage-A1.5.Q4_K_M.gguf",
    description:
      "35B mixture-of-experts model (3B active): its experts run from system memory, the rest on an 8 GB or larger GPU. Strong general and coding answers.",
  },
  {
    entry_id: "qwen3.8-27b-ud-q4_k_m-unsloth-gguf",
    name: "Qwen3.8 27B",
    tier: "large",
    upstream_model: "unsloth/Qwen3.8-27B-GGUF",
    upstream_revision: "4af51b3542f775b0a8e4b310bfb3f17e01c306c9",
    source_weight_digest: null,
    conversion_tool: "llama.cpp (as published upstream; exact build not stated)",
    conversion_version: "unknown — not stated in upstream repo",
    quantisation_method: "UD-Q4_K_M",
    artifact_digest: "1bce504dfecd84153666928a41d8a66706f0158d3a317bc5196b72819d7dc529",
    size_bytes: 16_564_259_744,
    file_name: "Qwen3.8-27B-UD-Q4_K_M.gguf",
    licence: "Apache-2.0",
    licence_reference: "licenses/models/Qwen3.8-27B-LICENSE.txt",
    publisher: "Unsloth (community GGUF of Qwen/Qwen3.8-27B)",
    pipeline: "third-party",
    context_length: 32_768,
    min_ram_gb: 64,
    min_vram_gb: 24,
    mirror_url: "https://huggingface.co/unsloth/Qwen3.8-27B-GGUF/resolve/4af51b3542f775b0a8e4b310bfb3f17e01c306c9/Qwen3.8-27B-UD-Q4_K_M.gguf",
    description:
      "Runs fully on a GPU with 24 GB or more. The most widely used model of its size; 201 languages.",
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
  recommended_entry_id: "ornith-1.5-9b-q4_k_m-ornith-gguf",
};

export const MINIMUM_PROFILE = { ram_gb: 8, free_disk_gb: 10 };

export function catalogueEntry(id: string | null | undefined): CatalogueEntry | undefined {
  return CATALOGUE.find((e) => e.entry_id === id);
}

/**
 * The one model to suggest (same rule as the backend, apps/models/hardware.py): the "General and
 * chat" picks of the Local Model Catalogue v3 for Windows PCs, best first. Integrated graphics and
 * a GPU without a driver count as no dedicated GPU. Only reviewed entries (MVP 9.6) that fit on the
 * drive are suggested; otherwise the next row is tried.
 */
export const PROFILES: Array<{ min_vram_gb: number; min_ram_gb: number; entry_id: string }> = [
  { min_vram_gb: 24, min_ram_gb: 64, entry_id: "qwen3.8-27b-ud-q4_k_m-unsloth-gguf" },
  { min_vram_gb: 8, min_ram_gb: 32, entry_id: "sage-a1.5-q4_k_m-mradermacher-gguf" },
  { min_vram_gb: 8, min_ram_gb: 16, entry_id: "ornith-1.5-9b-q4_k_m-ornith-gguf" },
  { min_vram_gb: 0, min_ram_gb: 8, entry_id: "minicpm5-2b-q4_k_m-openbmb-gguf" },
];

export function installable(entry: CatalogueEntry): boolean {
  if (entry.pipeline === "own") return true;
  const r = entry.deviation_approval;
  return !!r && !!r.reviewer.trim() && !!r.date && r.quality_threshold_result === "pass";
}

export function recommendFor(hw: Hardware): CatalogueEntry | null {
  if (hw.ram_gb < MINIMUM_PROFILE.ram_gb || hw.free_disk_gb < MINIMUM_PROFILE.free_disk_gb) return null;
  const vram = hw.gpu && hw.gpu.driver_ok ? hw.gpu.vram_gb : 0;
  for (const p of PROFILES) {
    const entry = catalogueEntry(p.entry_id);
    if (!entry || vram < p.min_vram_gb || hw.ram_gb < p.min_ram_gb || !installable(entry)) continue;
    if (hw.free_disk_gb * 1024 ** 3 < entry.size_bytes + 2 * 1024 ** 3) continue;
    return entry;
  }
  return null;
}

export function tierFor(hw: Hardware): CatalogueEntry["tier"] | null {
  return recommendFor(hw)?.tier ?? null;
}

export function hardwareSupports(entry: CatalogueEntry, hw: Hardware): boolean {
  if (hw.free_disk_gb * 1024 ** 3 < entry.size_bytes + 2 * 1024 ** 3) return false;
  if (hw.ram_gb >= entry.min_ram_gb) return true;
  return !!hw.gpu && hw.gpu.vram_gb >= entry.min_vram_gb && entry.min_vram_gb > 0;
}
