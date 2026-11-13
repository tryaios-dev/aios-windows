/**
 * Live lookups the timeline and detail sheet use to turn identifiers in an
 * event into names. Titles come from the store, so a deleted conversation
 * reads as removed instead of leaking a stale title.
 */
import { useMemo } from 'react'
import { selectCompanyModelName, useStore } from '@/lib/store'
import { CATALOGUE, catalogueEntry } from '@/data/catalogue'
import type { ContextLookups } from './eventMeta'

export function useEventLookups(): ContextLookups {
  const conversations = useStore((s) => s.conversations)
  const projects = useStore((s) => s.projects)
  const installed = useStore((s) => s.installedModels)
  const company = useStore((s) => s.health.company)
  const companyModel = useStore(selectCompanyModelName)

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
        }
        if (entryId) return catalogueEntry(entryId)?.name
        // The company server reports its model by name only (GET /system/status).
        return company.enabled ? companyModel : undefined
      },
    }),
    [conversations, projects, installed, company, companyModel],
  )
}
