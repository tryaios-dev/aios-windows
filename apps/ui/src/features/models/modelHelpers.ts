import type { CatalogueEntry, Hardware, InstalledModel } from '@/lib/types'
import { formatBytes } from '@/lib/format'
import { fitOnThisComputer, modelFit, wordsPerSecond, type Fit } from '@/lib/words'
import type { DotTone } from '@/components/ui/chips'

export const GB = 1024 ** 3

/** Dot colour for "how it runs here": green runs well, brass runs slowly, neutral cannot run. */
export const FIT_TONE: Record<Fit, DotTone> = { well: 'green', slowly: 'brass', no: 'neutral' }
/** Space AIOS keeps free next to the file while it downloads and checks it. */
export const WORKING_SPACE_BYTES = 2 * GB

/**
 * How an entry runs here, as the backend worked it out. An installed model already has its
 * space on the drive; the backend leaves the free-space check out for it.
 */
export function fitFor(entry: CatalogueEntry, hw: Hardware): { fit: Fit; line: string } {
  return fitOnThisComputer(entry, hw)
}

/** Why Install is unavailable, with the figures a person can act on. */
export function cannotInstallReason(entry: CatalogueEntry, hw: Hardware): string {
  const needed = entry.size_bytes + WORKING_SPACE_BYTES
  if (modelFit(entry, hw)?.reason === 'disk') return `It needs ${formatBytes(needed)} free. This computer has ${hw.free_disk_gb} GB.`
  // A display adapter without memory of its own (a VM's, or basic graphics) is not worth naming.
  const card = hw.gpu && hw.gpu.vram_gb > 0 ? `, and ${hw.gpu.vram_gb} GB on the graphics card` : ''
  return `It needs more memory than this computer has (${hw.ram_gb} GB${card}).`
}

/** Where the model runs on this computer, in everyday words. */
export function runsOnWords(entry: CatalogueEntry, hw: Hardware): string {
  const f = modelFit(entry, hw)
  if (!f || !f.runs_on) return 'It does not fit on this computer'
  const where = f.runs_on === 'card' ? 'On the graphics card' : f.runs_on === 'split' ? 'Partly on the graphics card, partly in memory' : 'On the processor'
  if (!f.tokens_per_second) return where
  return `${where}, about ${wordsPerSecond(f.tokens_per_second)} words a second (${f.measured ? 'measured' : 'estimated'})`
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

/** Technical line for the Details record: where it runs here and how fast. */
export function requirementText(entry: CatalogueEntry, hw: Hardware): string {
  const f = modelFit(entry, hw)
  if (!f || !f.runs_on) return f?.reason === 'disk' ? 'Not enough free disk space' : 'Not enough memory'
  const where = f.runs_on === 'card' ? 'GPU' : f.runs_on === 'split' ? 'GPU + RAM' : 'CPU'
  const speed = f.tokens_per_second ? `, ${f.tokens_per_second} tokens/s${f.measured ? ' (measured)' : ' (estimated)'}` : ''
  return `${where}${speed}`
}

/**
 * One realistic job per size, so "Light" and "Standard" mean something.
 * (Belongs next to sizeBlurb in src/lib/words.ts once that file is open for edits.)
 */
export function sizeExample(tier: CatalogueEntry['tier']): string {
  return tier === 'small' ? 'Tidying an email, or a quick summary of a page of notes.' : 'A long report, or a careful comparison of two options.'
}

/** What a computer needs to run an entry, in everyday words. */
export function needsWords(entry: CatalogueEntry, hw: Hardware): string {
  const space = formatBytes(entry.size_bytes + WORKING_SPACE_BYTES, 0)
  return `${space} of free space. ${runsOnWords(entry, hw)}.`
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
