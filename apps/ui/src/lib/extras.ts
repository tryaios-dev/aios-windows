/**
 * My secure knowledge, skills and resources. Knowledge and skills are loaded from the backend
 * (GET /knowledge, GET /skills, `@/bridge/live`). Nothing here is sample data.
 */
import { create } from 'zustand'
import type { InstalledSkill, KnowledgeDoc, LinkedResource, SkillEntry } from './types'

export interface IncomingFile {
  name: string
  size_bytes: number
  pages?: number
  /** Where it is on this computer (desktop app); missing when it is not known. */
  path?: string
}

export interface SkillInstall {
  /** 0 to 1. */
  progress: number
  stage: 'downloading' | 'checking'
}

interface ExtrasState {
  knowledge: KnowledgeDoc[]
  /** The skills AIOS lists, and those added from a file (GET /skills). */
  skillCatalogue: SkillEntry[]
  installedSkills: InstalledSkill[]
  skillInstalls: Record<string, SkillInstall>
  linkedResources: LinkedResource[]
  /** The person has opened AI models since the newest model was listed. */
  modelsSeen: boolean
  markModelsSeen: () => void
}

export const useExtras = create<ExtrasState>()((set) => ({
  knowledge: [],
  skillCatalogue: [],
  installedSkills: [],
  skillInstalls: {},
  linkedResources: [],
  modelsSeen: false,
  markModelsSeen: () => set({ modelsSeen: true }),
}))

/** How many documents are ready, still being added, or could not be read, and the size of the ready ones. */
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
