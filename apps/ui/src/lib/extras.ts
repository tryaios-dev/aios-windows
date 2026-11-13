/**
 * My secure knowledge, skills and resources: the simulated backend for the
 * three areas added on 12 November 2026. It is a store of its own so the
 * conversation store stays as it was, and it records what happens through
 * the same activity record.
 *
 * Nothing here is real: documents are not read, skills are not run and
 * nothing is sent to a provider. Timings stand in for work the real
 * application will do.
 */
import { create } from 'zustand'
import { useStore } from './store'
import type { InstalledSkill, KnowledgeDoc, LinkedResource } from './types'
import { SEED_KNOWLEDGE, kindOf, unreadableReason } from '@/data/knowledge'
import { skillById } from '@/data/skills'
import { resourceById } from '@/data/resources'

export interface IncomingFile {
  name: string
  size_bytes: number
  pages?: number
}

export interface SkillInstall {
  /** 0 to 1. */
  progress: number
  stage: 'downloading' | 'checking'
}

interface ExtrasState {
  knowledge: KnowledgeDoc[]
  installedSkills: InstalledSkill[]
  skillInstalls: Record<string, SkillInstall>
  linkedResources: LinkedResource[]
  /** The person has opened AI models since the newest model was listed. */
  modelsSeen: boolean

  /** Copy files in and read them. Originals are never touched. */
  addKnowledge: (files: IncomingFile[], from: { collection: string; origin: string }) => void
  removeKnowledge: (id: string) => void
  retryKnowledge: (id: string) => void
  installSkill: (id: string) => void
  removeSkill: (id: string) => void
  setSkillEnabled: (id: string, enabled: boolean) => void
  linkResource: (id: string, monthlyLimit: number | null) => void
  unlinkResource: (id: string) => void
  markModelsSeen: () => void
  reset: (fresh: boolean) => void
}

const DAY = 86_400_000
let counter = 0
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(counter += 1)}`
const timers = new Set<ReturnType<typeof setTimeout>>()
const later = (ms: number, fn: () => void) => {
  const t = setTimeout(() => {
    timers.delete(t)
    fn()
  }, ms)
  timers.add(t)
}

function seeded(fresh: boolean): Pick<ExtrasState, 'knowledge' | 'installedSkills' | 'skillInstalls' | 'linkedResources' | 'modelsSeen'> {
  if (fresh) return { knowledge: [], installedSkills: [], skillInstalls: {}, linkedResources: [], modelsSeen: false }
  return {
    knowledge: SEED_KNOWLEDGE.map((d) => ({ ...d })),
    installedSkills: [{ id: 'minutes', installed_at: new Date(Date.now() - 5 * DAY).toISOString(), enabled: true }],
    skillInstalls: {},
    linkedResources: [],
    modelsSeen: false,
  }
}

const record = (draft: Parameters<ReturnType<typeof useStore.getState>['_appendEvent']>[0]) => useStore.getState()._appendEvent(draft)

export const useExtras = create<ExtrasState>()((set, get) => {
  const patchDoc = (id: string, patch: Partial<KnowledgeDoc>) => set((s) => ({ knowledge: s.knowledge.map((d) => (d.id === id ? { ...d, ...patch } : d)) }))

  /** Copy, then read. A file AIOS cannot read stops at the reading stage and says why. */
  const process = (ids: string[], batch: { collection: string }) => {
    let done = 0
    const finish = () => {
      done += 1
      if (done < ids.length) return
      const docs = get().knowledge.filter((d) => ids.includes(d.id))
      if (!docs.length) return
      const ready = docs.filter((d) => d.status === 'ready').length
      record({ event_type: 'knowledge_added', actor: 'user', payload: { documents: ready, could_not_read: docs.length - ready, collection: batch.collection, size_bytes: docs.reduce((n, d) => n + d.size_bytes, 0) } })
    }
    ids.forEach((id, i) => {
      const doc = get().knowledge.find((d) => d.id === id)
      if (!doc) return
      // Two at a time, a little longer for bigger files.
      const start = Math.floor(i / 2) * 900 + (i % 2) * 250
      const copy = 500 + Math.min(1400, doc.size_bytes / 4000)
      const read = 900 + Math.min(2600, doc.size_bytes / 1800)
      later(start + copy, () => {
        if (!get().knowledge.some((d) => d.id === id)) return finish()
        patchDoc(id, { status: 'reading' })
        later(read, () => {
          if (!get().knowledge.some((d) => d.id === id)) return finish()
          const problem = unreadableReason(doc.name)
          patchDoc(id, problem ? { status: 'failed', problem } : { status: 'ready', problem: undefined })
          finish()
        })
      })
    })
  }

  return {
    ...seeded(useStore.getState().ui.freshInstall),

    addKnowledge: (files, from) => {
      if (!files.length) return
      const existing = new Set(get().knowledge.map((d) => `${d.collection}/${d.name}`.toLowerCase()))
      const now = new Date().toISOString()
      // A file that is already here is not added a second time.
      const docs: KnowledgeDoc[] = files
        .filter((f) => !existing.has(`${from.collection}/${f.name}`.toLowerCase()))
        .map((f) => ({ id: newId('kd'), name: f.name, kind: kindOf(f.name), size_bytes: f.size_bytes, pages: f.pages, collection: from.collection, origin: from.origin, added_at: now, status: 'copying' as const }))
      if (!docs.length) {
        useStore.getState().toast({ kind: 'info', title: 'Already in your knowledge', description: 'Those documents were added before. Nothing was copied twice.' })
        return
      }
      set((s) => ({ knowledge: [...docs, ...s.knowledge] }))
      process(docs.map((d) => d.id), { collection: from.collection })
    },

    removeKnowledge: (id) => {
      const doc = get().knowledge.find((d) => d.id === id)
      if (!doc) return
      set((s) => ({ knowledge: s.knowledge.filter((d) => d.id !== id) }))
      record({ event_type: 'knowledge_removed', actor: 'user', payload: { documents: 1, collection: doc.collection } })
    },

    retryKnowledge: (id) => {
      const doc = get().knowledge.find((d) => d.id === id)
      if (!doc) return
      patchDoc(id, { status: 'copying', problem: undefined })
      process([id], { collection: doc.collection })
    },

    installSkill: (id) => {
      const skill = skillById(id)
      if (!skill || get().skillInstalls[id] || get().installedSkills.some((s) => s.id === id)) return
      set((s) => ({ skillInstalls: { ...s.skillInstalls, [id]: { progress: 0, stage: 'downloading' } } }))
      // Bigger skills take a little longer; none takes more than a few seconds here.
      const steps = Math.max(6, Math.min(22, Math.round(skill.size_bytes / 40_000_000) + 6))
      let step = 0
      const tick = () => {
        if (!get().skillInstalls[id]) return
        step += 1
        if (step < steps) {
          set((s) => ({ skillInstalls: { ...s.skillInstalls, [id]: { progress: step / steps, stage: 'downloading' } } }))
          later(160, tick)
          return
        }
        set((s) => ({ skillInstalls: { ...s.skillInstalls, [id]: { progress: 1, stage: 'checking' } } }))
        later(900, () => {
          if (!get().skillInstalls[id]) return
          set((s) => {
            const rest = { ...s.skillInstalls }
            delete rest[id]
            return { skillInstalls: rest, installedSkills: [{ id, installed_at: new Date().toISOString(), enabled: true }, ...s.installedSkills] }
          })
          record({ event_type: 'skill_installed', actor: 'user', payload: { skill: skill.name, publisher: skill.publisher, version: skill.version, licence: skill.licence } })
        })
      }
      later(160, tick)
    },

    removeSkill: (id) => {
      const skill = skillById(id)
      if (!skill || skill.included) return
      set((s) => {
        const rest = { ...s.skillInstalls }
        delete rest[id]
        return { skillInstalls: rest, installedSkills: s.installedSkills.filter((x) => x.id !== id) }
      })
      record({ event_type: 'skill_removed', actor: 'user', payload: { skill: skill.name } })
    },

    setSkillEnabled: (id, enabled) => set((s) => ({ installedSkills: s.installedSkills.map((x) => (x.id === id ? { ...x, enabled } : x)) })),

    linkResource: (id, monthlyLimit) => {
      const resource = resourceById(id)
      if (!resource || get().linkedResources.some((r) => r.id === id)) return
      set((s) => ({ linkedResources: [{ id, linked_at: new Date().toISOString(), monthly_limit: monthlyLimit, spent: 0, uses: 0 }, ...s.linkedResources] }))
      // Linking sends nothing. It only makes the resource available to choose later.
      record({ event_type: 'resource_linked', actor: 'user', payload: { resource: resource.name, provider: resource.provider, monthly_limit: monthlyLimit } })
    },

    unlinkResource: (id) => {
      const resource = resourceById(id)
      if (!resource) return
      set((s) => ({ linkedResources: s.linkedResources.filter((r) => r.id !== id) }))
      record({ event_type: 'resource_unlinked', actor: 'user', payload: { resource: resource.name, provider: resource.provider } })
    },

    markModelsSeen: () => set({ modelsSeen: true }),

    reset: (fresh) => {
      for (const t of timers) clearTimeout(t)
      timers.clear()
      set(seeded(fresh))
    },
  }
})

// The prototype's reset buttons live in the main store; it announces a reset and this store follows.
if (typeof window !== 'undefined') {
  window.addEventListener('aios:reset', (e) => useExtras.getState().reset(!!(e as CustomEvent<{ fresh?: boolean }>).detail?.fresh))
}

/** Everything ready to be used by the AI, as a count and a size. */
export function knowledgeTotals(docs: KnowledgeDoc[]): { ready: number; working: number; failed: number; size: number } {
  let ready = 0
  let working = 0
  let failed = 0
  let size = 0
  for (const d of docs) {
    if (d.status === 'ready') {
      ready += 1
      size += d.size_bytes
    } else if (d.status === 'failed') failed += 1
    else working += 1
  }
  return { ready, working, failed, size }
}

// Turning the "newer AI model" switch back on is news again.
useStore.subscribe(
  (s) => s.sim.newModelOut,
  (out) => {
    if (out) useExtras.setState({ modelsSeen: false })
  },
)
