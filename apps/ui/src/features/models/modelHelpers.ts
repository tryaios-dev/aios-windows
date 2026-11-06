import type { CatalogueEntry, EngineBuild, Hardware, InstalledModel, ModelTier } from "@/lib/types";
import { formatBytes, formatDuration } from "@/lib/format";

export const GB = 1024 ** 3;
/** Working space the installer keeps free next to the model file while it downloads and verifies. */
export const WORKING_SPACE_BYTES = 2 * GB;

export function tierLabel(tier: ModelTier): string {
  return tier === "small" ? "Small" : "Medium";
}

export function contextLabel(contextLength: number): string {
  return `${Math.round(contextLength / 1024)}k context`;
}

export function engineBuildLabel(build: EngineBuild): string {
  return build === "cpu" ? "CPU" : "GPU";
}

export function bytesNeeded(entry: CatalogueEntry): number {
  return entry.size_bytes + WORKING_SPACE_BYTES;
}

/** Free disk covers the file plus working space. Mirrors the disk half of `hardwareSupports`. */
export function diskFits(entry: CatalogueEntry, hw: Hardware): boolean {
  return hw.free_disk_gb * GB >= bytesNeeded(entry);
}

/** Memory or GPU meets the entry's minimum. Mirrors the memory half of `hardwareSupports`. */
export function memoryFits(entry: CatalogueEntry, hw: Hardware): boolean {
  if (hw.ram_gb >= entry.min_ram_gb) return true;
  return !!hw.gpu && entry.min_vram_gb > 0 && hw.gpu.vram_gb >= entry.min_vram_gb;
}

export function requirementText(entry: CatalogueEntry): string {
  return entry.min_vram_gb > 0
    ? `Needs ${entry.min_ram_gb} GB memory or a GPU with ${entry.min_vram_gb} GB`
    : `Needs ${entry.min_ram_gb} GB memory`;
}

export function machineHas(hw: Hardware): string {
  return hw.gpu ? `${hw.ram_gb} GB memory and a GPU with ${hw.gpu.vram_gb} GB` : `${hw.ram_gb} GB memory and no GPU`;
}

export function freeSpaceText(entry: CatalogueEntry, hw: Hardware): string {
  const needed = formatBytes(bytesNeeded(entry));
  return diskFits(entry, hw)
    ? `${needed} needed including working space · ${hw.free_disk_gb} GB free`
    : `Not enough free disk. ${needed} needed including 2 GB working space; ${hw.free_disk_gb} GB free.`;
}

export function sourceLabel(source: InstalledModel["source"]): string {
  return source === "download" ? "Downloaded from the model mirror" : "Imported from an offline package";
}

export function timeToFirstWord(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
}

/** "about 1 min left" style estimate for a running download. Null while the speed is unknown. */
export function remainingLabel(bytesLeft: number, speedBps: number): string | null {
  if (speedBps <= 0) return null;
  const seconds = bytesLeft / speedBps;
  if (seconds < 10) return "a few seconds left";
  if (seconds < 60) return `about ${Math.ceil(seconds / 10) * 10} s left`;
  return `about ${formatDuration(Math.round(seconds / 60) * 60)} left`;
}

/** Short relative time for the catalogue check line: "3 h ago". */
export function shortAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
