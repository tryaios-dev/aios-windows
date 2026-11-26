import type { CatalogueEntry } from '@/lib/types'

/**
 * Model Catalogue v1 (MVP 9.6): the AI models AIOS may install. Empty until the backend answers
 * GET /models/catalogue; `@/bridge/live` fills it before the first screen renders and again after
 * each catalogue check. Nothing is listed here by hand.
 */
export const CATALOGUE: CatalogueEntry[] = []

/** Replace the list with the backend's (same array, so every module that imported it sees the change). */
export function setCatalogue(entries: CatalogueEntry[]): void {
  CATALOGUE.splice(0, CATALOGUE.length, ...entries)
}

/** The smallest computer AIOS runs on (the same rule as the backend, apps/models/fit.py). */
export const MINIMUM_PROFILE = { ram_gb: 8, free_disk_gb: 10 }

export function catalogueEntry(id: string | null | undefined): CatalogueEntry | undefined {
  return CATALOGUE.find((e) => e.entry_id === id)
}

/** Own-pipeline entries, or third-party ones whose review passed (MVP 9.6). */
export function installable(entry: CatalogueEntry): boolean {
  if (entry.pipeline === 'own') return true
  const r = entry.deviation_approval
  return !!r && !!r.reviewer.trim() && !!r.date && r.quality_threshold_result === 'pass'
}

