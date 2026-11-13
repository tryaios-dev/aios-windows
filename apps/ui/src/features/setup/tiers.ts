import type { CatalogueEntry, Hardware, ModelTier } from '@/lib/types'
import { CATALOGUE, catalogueEntry, installable } from '@/data/catalogue'
import { useStore } from '@/lib/store'
import { fitOnThisComputer } from '@/lib/words'

export const TIERS: ModelTier[] = ['small', 'medium', 'large']

/** The sizes the backend's catalogue offers, smallest first. */
export function availableTiers(): ModelTier[] {
  return TIERS.filter((t) => CATALOGUE.some((e) => e.tier === t && installable(e)))
}

/** Room a download needs beyond the file itself while it is being checked. */
export const WORKING_SPACE_BYTES = 2 * 1024 ** 3
export const GIB = 1024 ** 3

/**
 * The AI model AIOS sets up for a size: the one the backend suggests for this computer when it is
 * that size, otherwise the first reviewed entry of that size in the backend's catalogue.
 */
export function tierEntry(tier: ModelTier): CatalogueEntry {
  const suggested = catalogueEntry(useStore.getState().hardware.recommended_entry_id)
  if (suggested && suggested.tier === tier) return suggested
  return CATALOGUE.find((e) => e.tier === tier && installable(e)) ?? CATALOGUE.find((e) => e.tier === tier)!
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
  if (recommended && availableTiers().includes('small') && fitOnThisComputer(tierEntry('small'), hw).fit !== 'no') return 'small'
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
