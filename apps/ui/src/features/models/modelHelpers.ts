import type { CatalogueEntry, Hardware, InstalledModel } from '@/lib/types'
import { formatBytes } from '@/lib/format'
import { fitOnThisComputer, type Fit } from '@/lib/words'
import type { DotTone } from '@/components/ui/chips'

export const GB = 1024 ** 3

/** Dot colour for "how it runs here": green runs well, brass runs slowly, neutral cannot run. */
export const FIT_TONE: Record<Fit, DotTone> = { well: 'green', slowly: 'brass', no: 'neutral' }
/** Space AIOS keeps free next to the file while it downloads and checks it. */
export const WORKING_SPACE_BYTES = 2 * GB

/**
 * How an entry runs here. A model that is already installed has paid for its
 * disk space, so the free-space half of the check is taken out for it.
 */
export function fitFor(entry: CatalogueEntry, hw: Hardware, installed: boolean): { fit: Fit; line: string } {
  if (!installed) return fitOnThisComputer(entry, hw)
  return fitOnThisComputer(entry, { ...hw, free_disk_gb: hw.free_disk_gb + (entry.size_bytes + WORKING_SPACE_BYTES) / GB })
}

/** Why Install is unavailable, with the figures a person can act on. */
export function cannotInstallReason(entry: CatalogueEntry, hw: Hardware): string {
  const needed = entry.size_bytes + WORKING_SPACE_BYTES
  if (hw.free_disk_gb * GB < needed) return `It needs ${formatBytes(needed)} free. This computer has ${hw.free_disk_gb} GB.`
  return entry.min_vram_gb > 0
    ? `It needs ${entry.min_ram_gb} GB of memory, or a graphics card with ${entry.min_vram_gb} GB. This computer has ${hw.ram_gb} GB of memory.`
    : `It needs ${entry.min_ram_gb} GB of memory. This computer has ${hw.ram_gb} GB.`
}

/** Where an AI model's file is downloaded from: its publisher's own address, for example "huggingface.co". */
export function publisherHost(entry: Pick<CatalogueEntry, 'mirror_url'>): string {
  try {
    return new URL(entry.mirror_url).host
  } catch {
    return 'its publisher'
  }
}

export function sourceWords(source: InstalledModel['source'], entry?: Pick<CatalogueEntry, 'mirror_url'>): string {
  if (source !== 'download') return 'The model file that came with your installer'
  return entry ? `Downloaded directly from its publisher, ${publisherHost(entry)}` : 'Downloaded directly from its publisher'
}

/** Technical requirement line for the Details record. */
export function requirementText(entry: CatalogueEntry): string {
  return entry.min_vram_gb > 0 ? `${entry.min_ram_gb} GB RAM, or a GPU with ${entry.min_vram_gb} GB VRAM` : `${entry.min_ram_gb} GB RAM`
}

/**
 * One realistic job per size, so "Light" and "Standard" mean something.
 * (Belongs next to sizeBlurb in src/lib/words.ts once that file is open for edits.)
 */
export function sizeExample(tier: CatalogueEntry['tier']): string {
  return tier === 'small' ? 'Tidying an email, or a quick summary of a page of notes.' : 'A long report, or a careful comparison of two options.'
}

/** What a computer needs to run an entry, in everyday words. */
export function needsWords(entry: CatalogueEntry): string {
  const space = formatBytes(entry.size_bytes + WORKING_SPACE_BYTES, 0)
  return entry.min_vram_gb > 0
    ? `${entry.min_ram_gb} GB of memory, or a graphics card with ${entry.min_vram_gb} GB. ${space} of free space.`
    : `${entry.min_ram_gb} GB of memory. ${space} of free space.`
}

/**
 * The entry to suggest for a first install: the first one of the recommended
 * size that runs here, otherwise the first Light one that does.
 */
export function recommendedEntry(entries: CatalogueEntry[], hw: Hardware, tier: CatalogueEntry['tier'] | null): CatalogueEntry | undefined {
  if (!tier) return undefined
  const runs = (e: CatalogueEntry) => fitOnThisComputer(e, hw).fit !== 'no'
  return entries.find((e) => e.tier === tier && runs(e)) ?? entries.find((e) => e.tier === 'small' && runs(e))
}
