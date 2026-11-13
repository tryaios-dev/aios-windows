/**
 * Live lookups the timeline and detail sheet use to turn identifiers in an
 * event into names. Titles come from the store, so a deleted conversation
 * reads as removed instead of leaking a stale title.
 */
import { useMemo } from 'react'
import { COMPANY_MODEL_ID, COMPANY_MODEL_NAME, useStore } from '@/lib/store'
import { CATALOGUE, catalogueEntry } from '@/data/catalogue'
import { hashHex } from '@/lib/hash'
import type { ContextLookups } from './eventMeta'

const COMPANY_DIGEST = hashHex(`company|${COMPANY_MODEL_ID}`)

export function useEventLookups(): ContextLookups {
  const conversations = useStore((s) => s.conversations)
  const projects = useStore((s) => s.projects)
  const installed = useStore((s) => s.installedModels)

  return useMemo<ContextLookups>(
    () => ({
      conversationTitle: (id) => conversations.find((c) => c.id === id)?.title,
      projectName: (id) => projects.find((p) => p.id === id)?.name,
      modelName: (digest, entryId) => {
        if (digest) {
          const local = installed.find((m) => m.artifact_digest === digest)
          if (local) return local.name
          const listed = CATALOGUE.find((e) => e.artifact_digest === digest)
          if (listed) return listed.name
          if (digest === COMPANY_DIGEST) return COMPANY_MODEL_NAME
        }
        return entryId ? catalogueEntry(entryId)?.name : undefined
      },
    }),
    [conversations, projects, installed],
  )
}
