/**
 * My secure knowledge, skills and resources. The backend has none of the three yet (proposed:
 * GET /knowledge, GET /skills, GET /resources), so every list is empty and stays empty until it
 * does. Nothing here is sample data and nothing here pretends to add, read, install or link.
 */
import { create } from 'zustand'
import type { InstalledSkill, KnowledgeDoc, LinkedResource } from './types'

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
  markModelsSeen: () => void
}

export const useExtras = create<ExtrasState>()((set) => ({
  knowledge: [],
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
