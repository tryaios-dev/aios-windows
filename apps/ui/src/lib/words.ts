/**
 * Plain-language helpers shared by every screen. The vocabulary is fixed in
 * docs/GLOSSARY.md; change words there first, then here.
 */
import type { Benchmark, CatalogueEntry, Hardware, InstalledModel, ModelFit, ModelTier, Settings } from './types'
import { catalogueEntry } from '@/data/catalogue'
import { relativeTime } from './format'

/** Size word people see instead of "small tier" / "medium tier". */
export function sizeWord(tier: ModelTier): 'Light' | 'Standard' | 'Large' {
  return tier === 'small' ? 'Light' : tier === 'medium' ? 'Standard' : 'Large'
}

/** "Standard · Qwen3 8B": the size word first, the real model name always after it. */
export function modelLabel(model: Pick<InstalledModel, 'tier' | 'name'> | Pick<CatalogueEntry, 'tier' | 'name'> | undefined | null): string {
  if (!model) return 'No AI model'
  return `${sizeWord(model.tier)} · ${model.name}`
}

export function modelLabelById(id: string | null | undefined, installed: InstalledModel[]): string {
  const m = installed.find((x) => x.id === id) ?? catalogueEntry(id)
  return m ? modelLabel(m) : 'No AI model'
}

/** What each size is good for, in one line. */
export function sizeBlurb(tier: ModelTier): string {
  if (tier === 'small') return 'Quick answers, rewriting and short summaries. Runs on most computers.'
  if (tier === 'medium') return 'Better at longer drafts, careful summaries and working a problem through.'
  return 'The strongest answers. Needs a strong graphics card and a lot of memory.'
}

export type Fit = 'well' | 'slowly' | 'no'

/** The backend's verdict for one model on this computer (GET /system/hardware). */
export function modelFit(entry: Pick<CatalogueEntry, 'entry_id'>, hw: Hardware): ModelFit | undefined {
  return hw.models?.find((m) => m.entry_id === entry.entry_id)
}

/** Writing speed in words a second (about three words for every four tokens). */
export function wordsPerSecond(tokensPerSecond: number): number {
  return Math.max(1, Math.round(tokensPerSecond * 0.75))
}

/**
 * How a model will run on this computer, as a person would say it. The backend decides
 * (where it fits, how fast it writes); this only words it.
 */
export function fitOnThisComputer(entry: CatalogueEntry, hw: Hardware): { fit: Fit; line: string } {
  const f = modelFit(entry, hw)
  if (!f) return { fit: 'no', line: 'Not checked on this computer yet' }
  if (f.fit === 'no') {
    return { fit: 'no', line: f.reason === 'disk' ? 'Not enough free space on this computer' : 'Not enough memory on this computer' }
  }
  const words = f.tokens_per_second ? `about ${wordsPerSecond(f.tokens_per_second)} words a second` : ''
  if (f.fit === 'well') return { fit: 'well', line: words ? `Runs well on this computer, ${words}` : 'Runs well on this computer' }
  if (f.reason === 'first_word' && f.first_word_s) {
    return { fit: 'slowly', line: `Runs on this computer, but answers take about ${Math.round(f.first_word_s)} seconds to start` }
  }
  return { fit: 'slowly', line: words ? `Runs on this computer, slowly: ${words}` : 'Runs on this computer, slowly' }
}

/** Speed in words. The raw figures stay in Details. */
export function speedWords(b: Benchmark | undefined): { headline: string; line: string } {
  if (!b) return { headline: 'Not measured yet', line: 'Run a speed test to see how fast answers arrive on this computer.' }
  if (b.tokens_per_second >= 25) return { headline: 'Fast', line: 'Text arrives about as fast as you can read it.' }
  if (b.tokens_per_second >= 8) return { headline: 'Steady', line: 'Text arrives a little slower than you read. Long answers take a moment.' }
  return { headline: 'Slow', line: 'Expect a sentence every few seconds. Short questions work best.' }
}

export function waitWords(b: Benchmark | undefined): string {
  if (!b) return ''
  const s = b.time_to_first_token_ms / 1000
  if (s < 1) return 'Answers start almost at once.'
  if (s < 4) return `Answers start after about ${Math.round(s)} seconds.`
  return `Answers start after about ${Math.round(s)} seconds, longer in a long conversation.`
}

export type BackupTone = 'ok' | 'due' | 'none'

/** One status for the sidebar, Home and Settings. */
export function backupStatus(settings: Pick<Settings, 'last_backup_at' | 'backup_location'>, now = Date.now()): { tone: BackupTone; label: string; detail: string } {
  if (!settings.last_backup_at) {
    return { tone: 'none', label: 'No backup yet', detail: 'If this computer fails, your conversations are gone.' }
  }
  const days = Math.floor((now - new Date(settings.last_backup_at).getTime()) / 86400000)
  const when = relativeTime(settings.last_backup_at, now)
  if (days >= 14) return { tone: 'due', label: `Last backup ${when}`, detail: 'Work since then is not protected. Back up again.' }
  return { tone: 'ok', label: `Backed up ${when}`, detail: settings.backup_location ? `To ${settings.backup_location}` : '' }
}

/** Windows shortcut labels (the product is a Windows application). */
export const KEYS = { search: 'Ctrl K', settings: 'Ctrl ,', sidebar: 'Ctrl \\' }

/** The promise AIOS makes everywhere, in the one wording agreed on 12 November 2026. */
export const PROMISE = 'Nothing leaves this computer unless you say so.'

/** Where documents go, said wherever a hint about files is useful. */
export const FILES_HINT = 'Add documents in My secure knowledge, or paste text straight into a message.'
