import type { CatalogueEntry, Hardware, ModelTier } from '@/lib/types'
import { catalogueEntry } from '@/data/catalogue'
import { fitOnThisComputer } from '@/lib/words'

/** The AI model AIOS sets up for each size (MVP 4.1: Standard is Qwen3 8B, Light is Qwen3 4B). */
export const TIER_ENTRY: Record<ModelTier, string> = { small: 'qwen3-4b-q4km', medium: 'qwen3-8b-q4km' }

export const TIERS: ModelTier[] = ['small', 'medium']

/** Room a download needs beyond the file itself while it is being checked. */
export const WORKING_SPACE_BYTES = 2 * 1024 ** 3
export const GIB = 1024 ** 3

export function tierEntry(tier: ModelTier): CatalogueEntry {
  return catalogueEntry(TIER_ENTRY[tier])!
}

/** Whole gigabytes of free space the model needs, including room to check it. */
export function spaceNeededGb(entry: CatalogueEntry): number {
  return Math.ceil((entry.size_bytes + WORKING_SPACE_BYTES) / GIB)
}

/**
 * The size AIOS sets up unless the person chooses otherwise: the recommended
 * one when it really fits, otherwise Light when that fits, otherwise none.
 */
export function usableTier(recommended: ModelTier | null, hw: Hardware): ModelTier | null {
  if (recommended && fitOnThisComputer(tierEntry(recommended), hw).fit !== 'no') return recommended
  if (recommended && fitOnThisComputer(tierEntry('small'), hw).fit !== 'no') return 'small'
  return null
}

/** Why a size cannot be used here, as a person would say it. Null when it can. */
export function cannotRunReason(entry: CatalogueEntry, hw: Hardware): string | null {
  if (fitOnThisComputer(entry, hw).fit !== 'no') return null
  const need = spaceNeededGb(entry)
  if (hw.free_disk_gb < need) return `Needs ${need} GB of free space. This computer has ${hw.free_disk_gb} GB.`
  if (entry.min_vram_gb > 0) return `Needs ${entry.min_ram_gb} GB of memory, or a graphics card with ${entry.min_vram_gb} GB. This computer has ${hw.ram_gb} GB of memory.`
  return `Needs ${entry.min_ram_gb} GB of memory. This computer has ${hw.ram_gb} GB.`
}
