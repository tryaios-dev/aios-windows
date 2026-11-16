import type { KnowledgeDoc, KnowledgeStatus } from '@/lib/types'
import { pluralise } from '@/lib/format'
import type { BadgeTone } from '@/components/ui/chips'

/**
 * Documents in My secure knowledge, as search and chat show them: one line of
 * facts, and the status in a word or two. The icon for the kind of file is `DocIcon`.
 * Documents are found by name; what is inside them is not searched here.
 */

export const DOC_STATUS: Record<KnowledgeStatus, { label: string; tone: BadgeTone }> = {
  ready: { label: 'Ready', tone: 'green' },
  copying: { label: 'Being added', tone: 'neutral' },
  reading: { label: 'Being read', tone: 'neutral' },
  failed: { label: 'Could not be read', tone: 'brass' },
}

/** "PDF · Client contracts · 24 pages": the kind of file, the folder it came with, and its length when known. */
export function docFacts(doc: KnowledgeDoc): string {
  const parts = [doc.kind, doc.collection]
  if (doc.pages) parts.push(pluralise(doc.pages, 'page'))
  return parts.join(' · ')
}

/** Documents whose name contains the query, names that start with it first, then the most recently added. */
export function matchDocuments(docs: KnowledgeDoc[], query: string, min = 2): KnowledgeDoc[] {
  const q = query.trim().toLowerCase()
  if (q.length < min) return []
  return docs
    .filter((d) => d.name.toLowerCase().includes(q))
    .sort((a, b) => {
      const aStarts = a.name.toLowerCase().startsWith(q) ? 0 : 1
      const bStarts = b.name.toLowerCase().startsWith(q) ? 0 : 1
      return aStarts - bStarts || b.added_at.localeCompare(a.added_at)
    })
}
