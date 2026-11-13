import { useMemo } from 'react'
import { api } from '@/lib/api'

/**
 * The kind of thing people type into search: a name, a phrase from a document,
 * a subject. Shown as suggestions on the empty search page and in the palette.
 */
const CANDIDATES = ['Northgate', 'break clause', 'feedback form', 'rent review', 'expenses', 'onboarding']

const SHOWN = 3

/**
 * Up to three example searches. Ones that find something in this person's own
 * conversations come first, so pressing a suggestion shows real results; on a
 * new installation the plain examples are shown as they are.
 */
export function useExampleSearches(enabled = true): string[] {
  return useMemo(() => {
    if (!enabled) return []
    const found = CANDIDATES.filter((q) => api.search(q).length > 0)
    return (found.length >= 2 ? found : CANDIDATES).slice(0, SHOWN)
  }, [enabled])
}
