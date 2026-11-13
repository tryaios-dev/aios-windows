/**
 * Turns a recorded event into the sentence a person reads in Activity:
 * who did what, where, and when. The underlying record is unchanged;
 * "Verification details" shows it in full.
 */
import type { Conversation, EvidenceEvent, InstalledModel, Project } from './types'
import { CATALOGUE } from '@/data/catalogue'
import { formatBytes, pluralise } from './format'
import { sizeWord } from './words'

export type ActivityKind = 'questions' | 'knowledge' | 'models' | 'extending' | 'projects' | 'safety' | 'sharing' | 'system'

export const ACTIVITY_KINDS: Array<{ key: ActivityKind; label: string }> = [
  { key: 'questions', label: 'Questions and answers' },
  { key: 'knowledge', label: 'Knowledge' },
  { key: 'projects', label: 'Projects' },
  { key: 'models', label: 'AI models' },
  { key: 'extending', label: 'Skills and resources' },
  { key: 'safety', label: 'Backups and recovery' },
  { key: 'sharing', label: 'Sharing and moving' },
  { key: 'system', label: 'AIOS itself' },
]

export interface ActivityLine {
  kind: ActivityKind
  who: 'You' | 'AIOS' | 'An operator'
  what: string
  /** Extra context after the sentence, for example the conversation title. */
  about?: string
  /** "This computer", "Company server", or the name of the provider something was sent to. */
  where: string
  /** True when information left this computer. */
  left: boolean
}

export interface ActivityLookups {
  projects: Project[]
  conversations: Conversation[]
  installed: InstalledModel[]
  /** Sequence numbers of the first question in each conversation, from `firstQuestions`. Without it no entry reads as a start. */
  firstQuestions?: ReadonlySet<number>
}

/** A question the person asked, as opposed to the summary AIOS writes for a long conversation. */
export function isQuestion(e: EvidenceEvent): boolean {
  return e.event_type === 'request' && e.payload?.purpose !== 'summary'
}

/**
 * The first question recorded in each conversation, worked out from the record itself.
 * That entry reads as starting the conversation; every later one reads as a question in it.
 */
export function firstQuestions(events: EvidenceEvent[]): Set<number> {
  const first = new Map<string, number>()
  for (const e of events) {
    if (!isQuestion(e) || !e.conversation_id) continue
    const seen = first.get(e.conversation_id)
    if (seen === undefined || e.seq < seen) first.set(e.conversation_id, e.seq)
  }
  return new Set(first.values())
}

function modelNameByDigest(digest: string | undefined, installed: InstalledModel[]): string | null {
  if (!digest) return null
  const m = installed.find((x) => x.artifact_digest === digest) ?? CATALOGUE.find((x) => x.artifact_digest === digest)
  return m ? `${sizeWord(m.tier)} · ${m.name}` : null
}

/** Sensitivity labels are written the way the chips show them: Restricted, Internal, Public. */
function labelWord(value: unknown): string {
  const v = String(value ?? '')
  return v ? v.charAt(0).toUpperCase() + v.slice(1) : 'a new one'
}

/**
 * Each sentence starts with who did it ("You", "AIOS") and is written so the two read as one:
 * "You" + "Asked a question. The AI answered". No sequence numbers, fingerprints or internal names here.
 */
export function describeEvent(e: EvidenceEvent, l: ActivityLookups): ActivityLine {
  const who: ActivityLine['who'] = e.actor === 'user' ? 'You' : e.actor === 'operator' ? 'An operator' : 'AIOS'
  const project = l.projects.find((p) => p.id === e.project_id)?.name
  const conv = l.conversations.find((c) => c.id === e.conversation_id)
  const conversation = conv?.title
  const where: ActivityLine['where'] = e.provider === 'company' ? 'Company server' : 'This computer'
  const p = e.payload ?? {}
  const base = { who, where, left: e.provider === 'company' }
  const model = modelNameByDigest(e.model_digest, l.installed)

  switch (e.event_type) {
    case 'request': {
      if (p.purpose === 'summary') return { ...base, kind: 'questions', who: 'AIOS', what: 'Summarised the earlier messages in a long conversation, so the AI can keep track of it', about: conversation }
      const ai = e.provider === 'company' ? 'The AI on the company server' : 'The AI'
      // A conversation that arrived in a file or as a copy was not started by this question.
      const started = !p.regenerate && !!l.firstQuestions?.has(e.seq) && (!conv || conv.classification_source === 'project')
      const asked = p.regenerate ? 'Asked the same question again' : started ? (conversation ? `Started \u201c${conversation}\u201d and asked a question` : 'Started a conversation and asked a question') : 'Asked a question'
      if (p.status === 'stopped') return { ...base, kind: 'questions', what: `${asked}, then stopped the answer part-way`, about: conversation }
      const outcome = p.status === 'partial' ? 'The answer was cut off and saved as far as it got' : p.regenerate ? `${ai} gave a new answer` : `${ai} answered`
      return { ...base, kind: 'questions', what: `${asked}. ${outcome}`, about: conversation }
    }
    case 'refusal':
      return { ...base, kind: 'questions', who: 'AIOS', what: 'Did not send a message to the AI because it was too long', about: conversation }
    case 'provider_changed':
      if (p.scope === 'project_default') return { ...base, kind: 'sharing', what: p.enabled ? 'Set new conversations in a project to run on the company server' : 'Set new conversations in a project to run on this computer again', about: project, left: false }
      return { ...base, kind: 'sharing', what: e.provider === 'company' ? 'Moved a conversation to the company server. Its history was sent there' : 'Moved a conversation back to this computer. Nothing was sent', about: conversation }
    case 'project_created':
      return { ...base, kind: 'projects', what: p.default ? 'Created your first project' : 'Created a project', about: project }
    case 'project_reclassified':
      return { ...base, kind: 'projects', what: p.reviewed_copy ? `Made a copy of a project with a new sensitivity label, ${labelWord(p.to_class)}` : `Changed a project\u2019s sensitivity label to ${labelWord(p.to_class)}`, about: project }
    case 'project_deleted':
      return { ...base, kind: 'projects', what: typeof p.conversations === 'number' ? (p.conversations > 0 ? `Deleted a project and the ${pluralise(p.conversations, 'conversation')} in it` : 'Deleted an empty project') : 'Deleted a project and its conversations' }
    case 'conversation_created':
      return { ...base, kind: 'projects', what: 'Started a conversation', about: project }
    case 'conversation_deleted':
      return { ...base, kind: 'projects', what: 'Deleted a conversation', about: project }
    case 'disclosure_confirmed':
      return { ...base, kind: 'sharing', what: 'Agreed to send a conversation to the company server', about: conversation }
    case 'model_installed':
      return { ...base, kind: 'models', what: `Installed ${model ? `the AI model ${model}` : 'an AI model'}. AIOS checked it is the genuine, unmodified file`, about: typeof p.size_bytes === 'number' ? formatBytes(p.size_bytes) : undefined }
    case 'model_deleted':
      return { ...base, kind: 'models', what: `Removed ${model ? `the AI model ${model}` : 'an AI model'} from this computer` }
    case 'export':
      if (p.kind === 'backup') {
        const parts = [typeof p.conversations === 'number' ? pluralise(p.conversations, 'conversation') : null, typeof p.size_bytes === 'number' ? formatBytes(p.size_bytes) : null].filter(Boolean)
        return { ...base, kind: 'safety', what: 'Backed up your AIOS', about: parts.length ? parts.join(' · ') : undefined }
      }
      if (p.kind === 'evidence') return { ...base, kind: 'sharing', what: 'Saved a copy of the activity record that anyone can check', about: project }
      return { ...base, kind: 'sharing', what: 'Saved a project as a file', about: project }
    case 'import':
      return { ...base, kind: 'sharing', what: 'Added a project from a file', about: project }
    case 'restore':
      return { ...base, kind: 'safety', what: 'Restored your AIOS from a backup' }
    case 'continuation':
      return { ...base, kind: 'safety', who: 'AIOS', what: 'Carried on the activity record from where the backup ended' }
    case 'recovery_key_issued':
      return { ...base, kind: 'safety', who: p.reissued ? 'You' : 'AIOS', what: p.reissued ? 'Created a new recovery key. Older backups still need the older key' : 'Created your recovery key and showed it to you during setup' }
    case 'recovery_package_written':
      return { ...base, kind: 'safety', who: 'AIOS', what: 'Saved the recovery file that lets your recovery key open a backup' }
    case 'store_created':
      return { ...base, kind: 'system', who: 'AIOS', what: 'Set up secure storage for your conversations' }
    case 'install':
      return { ...base, kind: 'system', who: 'AIOS', what: `Was installed on this computer${p.app_version ? ` (version ${String(p.app_version)})` : ''}` }
    case 'key_rotation':
      return { ...base, kind: 'safety', who: 'AIOS', what: 'Replaced the key that seals the activity record' }
    case 'shutdown':
      return { ...base, kind: 'system', who: 'AIOS', what: 'Was closed, and sealed the activity record up to that point' }
    case 'knowledge_added': {
      const n = typeof p.documents === 'number' ? p.documents : 0
      const missed = typeof p.could_not_read === 'number' ? p.could_not_read : 0
      const added = n === 1 ? 'Added a document to your secure knowledge' : `Added ${n} documents to your secure knowledge`
      const what = n === 0 ? `Tried to add ${pluralise(missed, 'document')}, but AIOS could not read ${missed === 1 ? 'it' : 'them'}` : missed > 0 ? `${added}. AIOS could not read ${missed === 1 ? 'one other' : `${missed} others`}` : `${added}. The originals stayed where they were`
      return { ...base, kind: 'knowledge', what, about: typeof p.collection === 'string' ? p.collection : undefined }
    }
    case 'knowledge_removed':
      return { ...base, kind: 'knowledge', what: 'Removed a document from your secure knowledge. The original was not touched', about: typeof p.collection === 'string' ? p.collection : undefined }
    case 'skill_installed':
      return { ...base, kind: 'extending', what: `Added the skill ${p.skill ? `\u201c${String(p.skill)}\u201d` : ''} to your AI. AIOS checked it first`.replace('  ', ' '), about: typeof p.publisher === 'string' ? p.publisher : undefined }
    case 'skill_removed':
      return { ...base, kind: 'extending', what: `Removed the skill ${p.skill ? `\u201c${String(p.skill)}\u201d` : ''} from your AI`.replace('  ', ' ') }
    case 'resource_linked':
      return { ...base, kind: 'extending', what: `Linked ${p.resource ? String(p.resource) : 'a resource'} to your AI. Nothing was sent`, about: typeof p.provider === 'string' ? p.provider : undefined }
    case 'resource_unlinked':
      return { ...base, kind: 'extending', what: `Unlinked ${p.resource ? String(p.resource) : 'a resource'} from your AI`, about: typeof p.provider === 'string' ? p.provider : undefined }
    case 'disclosure':
      return { ...base, kind: 'sharing', what: `Sent ${p.what ? String(p.what) : 'part of a conversation'} to ${p.resource ? String(p.resource) : 'a linked resource'}, after you allowed it`, about: conversation, where: typeof p.provider === 'string' ? p.provider : 'A linked resource', left: true }
    default:
      return { ...base, kind: 'system', who: 'AIOS', what: 'Recorded something this version cannot describe in words' }
  }
}
