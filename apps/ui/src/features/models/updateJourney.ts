import { useMemo } from 'react'
import { create } from 'zustand'
import { useStore } from '@/lib/store'
import type { CatalogueEntry, InstalledModel } from '@/lib/types'
import { CATALOGUE } from '@/data/catalogue'

/**
 * Updating an installed AI model to a newer version of itself.
 *
 * Where the update has got to is read from the real state (what is installed,
 * what is downloading). The only thing remembered here is which updates the
 * person started on this page and which they have finished deciding about, so
 * the result is shown once and does not come back after "Keep the old one too".
 */
interface JourneyState {
  stage: Record<string, 'started' | 'settled'>
  start: (entryId: string) => void
  settle: (entryId: string) => void
}

export const useUpdateJourney = create<JourneyState>()((set) => ({
  stage: {},
  start: (entryId) => set((s) => ({ stage: { ...s.stage, [entryId]: 'started' } })),
  settle: (entryId) => set((s) => ({ stage: { ...s.stage, [entryId]: 'settled' } })),
}))

// The prototype's reset buttons start everything again, this included.
if (typeof window !== 'undefined') {
  window.addEventListener('aios:reset', () => useUpdateJourney.setState({ stage: {} }))
}

/** Catalogue entries that are a newer version of another entry. */
const NEWER_VERSIONS = CATALOGUE.filter((e) => !!e.replaces)

export type UpdatePhase = 'offer' | 'updating' | 'ready'

export interface ModelUpdateState {
  /** The newer version. */
  entry: CatalogueEntry
  /** The installed AI model it is a newer version of. */
  current: InstalledModel
  /** The newer version, once it is installed. */
  newer?: InstalledModel
  phase: UpdatePhase
}

/**
 * The update to show at the top of AI models, if there is one:
 *   offer     a newer version of an installed AI model is listed and not installed;
 *   updating  it is downloading or being checked, while the current one keeps working;
 *   ready     it is installed next to the current one and the person has yet to say what happens to the old one.
 */
export function useModelUpdate(): ModelUpdateState | null {
  const installed = useStore((s) => s.installedModels)
  // A newer AI model is out when the backend's catalogue lists one that replaces another.
  const newModelOut = CATALOGUE.some((e) => !!e.replaces)
  // A plain string, so a download's progress ticks do not re-render the page.
  const downloadingIds = useStore((s) => {
    let ids = ''
    for (const e of NEWER_VERSIONS) {
      const d = s.downloads[e.entry_id]
      if (d && d.status !== 'done') ids += `${e.entry_id},`
    }
    return ids
  })
  const stage = useUpdateJourney((s) => s.stage)

  return useMemo(() => resolveUpdate(installed, newModelOut, downloadingIds, stage), [installed, newModelOut, downloadingIds, stage])
}

function resolveUpdate(installed: InstalledModel[], newModelOut: boolean, downloadingIds: string, stage: JourneyState['stage']): ModelUpdateState | null {
  const downloading = downloadingIds.split(',')
  for (const entry of NEWER_VERSIONS) {
    const current = installed.find((m) => m.catalogue_entry_id === entry.replaces)
    if (!current) continue
    const newer = installed.find((m) => m.catalogue_entry_id === entry.entry_id)
    if (newer) {
      if (stage[entry.entry_id] === 'started') return { entry, current, newer, phase: 'ready' }
      continue
    }
    if (downloading.includes(entry.entry_id)) return { entry, current, phase: 'updating' }
    if (newModelOut) return { entry, current, phase: 'offer' }
  }
  return null
}

/**
 * Whether a catalogue entry belongs in the list of AI models.
 * A newer version of an installed AI model is offered at the top of the page as an update, not in the list,
 * and when no newer version has been announced it is not offered at all.
 */
export function listedInCatalogue(entry: CatalogueEntry, installed: InstalledModel[], newModelOut: boolean, downloading: boolean): boolean {
  if (!entry.replaces) return true
  if (installed.some((m) => m.catalogue_entry_id === entry.entry_id)) return true
  const replacesInstalled = installed.some((m) => m.catalogue_entry_id === entry.replaces)
  if (replacesInstalled) return false
  return newModelOut || downloading
}
