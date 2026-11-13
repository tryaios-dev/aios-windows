/**
 * Presentation helpers for the plain Activity view. The words come from
 * `describeEvent` in @/lib/activity; nothing here writes a new sentence, it
 * only joins "who" and "what" and picks a colour icon for each kind and each entry.
 */
import type { ActivityKind, ActivityLine } from '@/lib/activity'
import type { Conversation, EvidenceEvent, InstalledModel } from '@/lib/types'
import { COMPANY_MODEL_NAME } from '@/lib/store'
import { CATALOGUE } from '@/data/catalogue'
import { modelLabel } from '@/lib/words'
import { ART, modelLogo } from '@/assets/icons'

/** One event, the sentence that describes it, and the conversation it can open (questions only). */
export interface ActivityRow {
  event: EvidenceEvent
  line: ActivityLine
  conversation?: Conversation
}

export type ActivityViewMode = 'plain' | 'verify'

/** The id of a day's heading in the list, so the chart can take you to it. */
export function dayAnchor(date: Date | string): string {
  const d = new Date(date)
  return `activity-day-${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

/** Value of the Project filter when no project is chosen. */
export const ALL_PROJECTS = 'all'

/** One colour icon per kind, for the filters and wherever a kind is named. */
export const KIND_ART: Record<ActivityKind, string> = {
  questions: ART.conversation,
  knowledge: ART.knowledge,
  projects: ART.folder,
  models: ART.model,
  extending: ART.skills,
  safety: ART.backup,
  sharing: ART.sent,
  system: ART.settings,
}

/**
 * The colour icon for one entry. More exact than its kind where that helps the eye:
 * a backup is a vault, a new document is a page with a plus, an AI model wears its own logo.
 */
export function eventArt(row: Pick<ActivityRow, 'event' | 'line'>): string {
  const { event, line } = row
  switch (event.event_type) {
    case 'refusal':
      return ART.warning
    case 'model_installed':
    case 'model_deleted':
      return modelLogo(line.what)
    case 'export':
      return event.payload?.kind === 'backup' ? ART.vault : event.payload?.kind === 'evidence' ? ART.about : ART.sent
    case 'recovery_package_written':
      return ART.vault
    case 'recovery_key_issued':
      return ART.recoveryKey
    case 'continuation':
      return ART.update
    case 'key_rotation':
    case 'store_created':
      return ART.encrypted
    case 'install':
      return ART.download
    case 'shutdown':
      return ART.lock
    case 'knowledge_added':
      return ART.addDocument
    case 'knowledge_removed':
      return ART.document
    case 'resource_linked':
    case 'resource_unlinked':
      return ART.resources
    default:
      return KIND_ART[line.kind]
  }
}

/**
 * `describeEvent` returns the actor and the action separately ("You" + "Asked a question. The AI answered").
 * Read together they are one sentence, so the action starts in lower case and ends with a full stop.
 */
export function sentenceParts(line: ActivityLine): { who: string; rest: string } {
  const what = line.what.trim()
  const rest = what.charAt(0).toLowerCase() + what.slice(1)
  return { who: line.who, rest: /[.!?]$/.test(rest) ? rest : `${rest}.` }
}

export function sentence(line: ActivityLine): string {
  const { who, rest } = sentenceParts(line)
  return `${who} ${rest}`
}

/** "Standard · Qwen3 8B" for the AI model an event names, in the same words the sentence uses. */
export function modelFact(event: EvidenceEvent, installed: InstalledModel[]): string | null {
  if (!event.model_digest) return null
  const model = installed.find((m) => m.artifact_digest === event.model_digest) ?? CATALOGUE.find((m) => m.artifact_digest === event.model_digest)
  if (model) return modelLabel(model)
  if (event.provider === 'company') return COMPANY_MODEL_NAME
  return 'An AI model that is no longer on this computer'
}
