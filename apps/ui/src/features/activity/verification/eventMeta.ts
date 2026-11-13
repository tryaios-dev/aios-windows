/**
 * Display metadata for Evidence Wire Format v1 event types, used only by the
 * "Verification details" depth of Activity: label, icon, and a one-line
 * context summary built from the content-free payload. Engineering vocabulary
 * is allowed here; the plain view takes its words from `describeEvent`.
 */
import type { LucideIcon } from 'lucide-react'
import {
  Archive,
  ArrowRightLeft,
  Database,
  Download,
  FileDown,
  FileUp,
  FolderMinus,
  FolderPlus,
  GitBranch,
  KeyRound,
  MessageSquare,
  MessageSquareX,
  Package,
  Power,
  RotateCcw,
  Shield,
  ShieldAlert,
  Trash2,
} from 'lucide-react'
import type { Classification, EventType, EvidenceEvent } from '@/lib/types'
import { formatBytes } from '@/lib/format'
import { shortHash } from '@/lib/hash'
import { CLASS_META } from '@/components/ui/chips'

export interface EventMeta {
  label: string
  icon: LucideIcon
}

export const EVENT_META: Record<EventType, EventMeta> = {
  request: { label: 'Request', icon: MessageSquare },
  model_installed: { label: 'Model installed', icon: Download },
  model_deleted: { label: 'Model deleted', icon: Trash2 },
  project_created: { label: 'Project created', icon: FolderPlus },
  project_reclassified: { label: 'Class changed', icon: Shield },
  project_deleted: { label: 'Project deleted', icon: FolderMinus },
  conversation_deleted: { label: 'Conversation deleted', icon: MessageSquareX },
  provider_changed: { label: 'Provider changed', icon: ArrowRightLeft },
  export: { label: 'Export', icon: FileDown },
  import: { label: 'Import', icon: FileUp },
  restore: { label: 'Restore', icon: RotateCcw },
  continuation: { label: 'Continuation', icon: GitBranch },
  key_rotation: { label: 'Key rotation', icon: KeyRound },
  refusal: { label: 'Refusal', icon: ShieldAlert },
  install: { label: 'Install', icon: Package },
  store_created: { label: 'Store created', icon: Database },
  recovery_package_written: { label: 'Recovery package written', icon: Archive },
  recovery_key_issued: { label: 'Recovery key issued', icon: KeyRound },
  shutdown: { label: 'Shutdown', icon: Power },
  knowledge_added: { label: 'Knowledge added', icon: FileUp },
  knowledge_removed: { label: 'Knowledge removed', icon: Trash2 },
  skill_installed: { label: 'Skill installed', icon: Package },
  skill_removed: { label: 'Skill removed', icon: Trash2 },
  resource_linked: { label: 'Resource linked', icon: ArrowRightLeft },
  resource_unlinked: { label: 'Resource unlinked', icon: ArrowRightLeft },
  disclosure: { label: 'Disclosure', icon: ShieldAlert },
}

export const ACTOR_LABEL: Record<EvidenceEvent['actor'], string> = {
  user: 'User',
  app: 'AIOS (app)',
  operator: 'Operator',
}

/** `#0042` for any sequence number. */
export function formatSeq(seq: number): string {
  return `#${String(seq).padStart(4, '0')}`
}

/** `#0012–#0057` for a closed range. */
export function formatSeqRange(from: number, to: number): string {
  return from === to ? formatSeq(from) : `${formatSeq(from)}–${formatSeq(to)}`
}

export interface ContextLookups {
  conversationTitle: (id: string) => string | undefined
  projectName: (id: string) => string | undefined
  modelName: (digest?: string, entryId?: string) => string | undefined
}

const classLabel = (v: unknown) => (typeof v === 'string' && v in CLASS_META ? CLASS_META[v as Classification].label : typeof v === 'string' ? v : '')

const str = (v: unknown) => (v === undefined || v === null ? undefined : String(v))
const num = (v: unknown) => (typeof v === 'number' ? v : undefined)

/**
 * One line that says what the event was about without showing any content.
 * Conversation titles are looked up live; a deleted conversation reads as removed.
 */
export function eventContext(e: EvidenceEvent, lookups: ContextLookups): string {
  const p = e.payload ?? {}
  const conv = e.conversation_id ? lookups.conversationTitle(e.conversation_id) : undefined
  const project = e.project_id ? lookups.projectName(e.project_id) : undefined
  const model = lookups.modelName(e.model_digest, str(p.entry_id))

  switch (e.event_type) {
    case 'request': {
      const title = conv ?? 'Conversation removed'
      if (p.purpose === 'summary') return `${title} · background summary`
      if (p.regenerate === true) return `${title} · regenerated`
      if (p.status && p.status !== 'complete') return `${title} · ${String(p.status)}`
      return title
    }
    case 'model_installed':
      return `${model ?? 'Model'} · ${p.source === 'offline' ? 'offline import' : 'download'}${num(p.size_bytes) ? ` · ${formatBytes(num(p.size_bytes)!)}` : ''}`
    case 'model_deleted':
      return `${model ?? 'Model'} · removed from this computer`
    case 'project_created':
      return `${project ?? 'Project removed'} · ${classLabel(p.classification) || 'Restricted'}${p.default === true ? ' · default project' : ''}`
    case 'project_reclassified': {
      const from = classLabel(p.from_class)
      const to = classLabel(p.to_class)
      const how = p.reviewed_copy === true ? 'reviewed copy' : 'in place'
      return from && to ? `${from} → ${to}, ${how}` : `${project ?? 'Project'} · class changed, ${how}`
    }
    case 'project_deleted': {
      const n = num(p.conversations)
      return `${project ?? 'Project removed'}${n !== undefined ? ` · ${n} conversation${n === 1 ? '' : 's'}` : ''}`
    }
    case 'conversation_deleted':
      return conv ?? 'Conversation removed'
    case 'provider_changed': {
      if (p.scope === 'project_default') return `Company AI for new conversations · ${p.enabled === true ? 'on' : 'off'}`
      const from = p.from === 'company' ? 'Company' : 'Local'
      const to = (p.to ?? e.provider) === 'company' ? 'Company' : 'Local'
      const note = p.history_sent === true ? 'history sent' : 'nothing sent'
      return `${conv ? `${conv} · ` : ''}${from} → ${to} · ${note}`
    }
    case 'export': {
      if (p.kind === 'evidence') {
        const a = num(p.first_seq)
        const b = num(p.last_seq)
        return `Evidence · ${a !== undefined && b !== undefined ? formatSeqRange(a, b) : str(p.scope) ?? 'range'}${num(p.checkpoints) !== undefined ? ` · ${num(p.checkpoints)} checkpoint${num(p.checkpoints) === 1 ? '' : 's'}` : ''}`
      }
      if (p.kind === 'backup') return `Backup${num(p.size_bytes) ? ` · ${formatBytes(num(p.size_bytes)!)}` : ''}`
      return `Project package${p.file_name ? ` · ${String(p.file_name)}` : project ? ` · ${project}` : ''}`
    }
    case 'import': {
      const c = num(p.conversations)
      const m = num(p.messages)
      const parts = [`Project package`]
      if (c !== undefined) parts.push(`${c} conversation${c === 1 ? '' : 's'}`)
      if (m !== undefined) parts.push(`${m} message${m === 1 ? '' : 's'}`)
      if (p.remapped === true) parts.push('identifiers remapped')
      return parts.join(' · ')
    }
    case 'restore':
      return `From backup${p.backup_path ? ` · ${String(p.backup_path)}` : ''}${p.restored_tip ? ` · tip ${shortHash(String(p.restored_tip), 6, 4)}` : ''}`
    case 'continuation':
      return `Epoch ${num(p.epoch) ?? e.epoch}${p.new_signer_key_id ? ` · new signer ${shortHash(String(p.new_signer_key_id), 6, 4)}` : ''}`
    case 'key_rotation':
      return `Signer key rotated${p.new_signer_key_id ? ` · ${shortHash(String(p.new_signer_key_id), 6, 4)}` : ''}`
    case 'refusal':
      return str(p.reason) ?? 'Request refused'
    case 'install':
      return `AIOS ${str(p.app_version) ?? ''}${p.installer ? ` · ${String(p.installer)}` : ''}`.trim()
    case 'store_created':
      return `chats.db · schema v${str(p.schema_version) ?? '1'}`
    case 'recovery_package_written':
      return `Recovery Package v${str(p.package_version) ?? '1'}`
    case 'recovery_key_issued':
      return 'Shown once, never stored'
    case 'shutdown':
      return p.checkpoint === true ? 'Clean shutdown · checkpoint signed' : 'Clean shutdown'
    case 'knowledge_added': {
      const n = num(p.documents) ?? 0
      const missed = num(p.could_not_read) ?? 0
      const parts = [`${n} document${n === 1 ? '' : 's'} copied in`]
      if (missed > 0) parts.push(`${missed} unreadable`)
      if (str(p.collection)) parts.push(str(p.collection)!)
      if (num(p.size_bytes)) parts.push(formatBytes(num(p.size_bytes)!))
      return parts.join(' · ')
    }
    case 'knowledge_removed': {
      const n = num(p.documents) ?? 1
      return `${n} document${n === 1 ? '' : 's'} removed${str(p.collection) ? ` · ${str(p.collection)}` : ''} · originals untouched`
    }
    case 'skill_installed':
      return [str(p.skill) ?? 'Skill', str(p.publisher), p.version ? `v${String(p.version)}` : undefined, str(p.licence)].filter(Boolean).join(' · ')
    case 'skill_removed':
      return `${str(p.skill) ?? 'Skill'} · removed`
    case 'resource_linked':
      return `${[str(p.resource) ?? 'Resource', str(p.provider)].filter(Boolean).join(' · ')} · linked, nothing sent`
    case 'resource_unlinked':
      return `${[str(p.resource) ?? 'Resource', str(p.provider)].filter(Boolean).join(' · ')} · unlinked`
    case 'disclosure':
      return `${conv ? `${conv} · ` : ''}${str(p.what) ?? 'content'} → ${[str(p.resource), str(p.provider)].filter(Boolean).join(' · ') || 'linked resource'} · allowed by the user`
    default:
      return ''
  }
}

/** Payload values rendered for the detail sheet, in insertion order. */
export function payloadRows(e: EvidenceEvent): Array<{ key: string; value: string }> {
  const p = e.payload
  if (!p) return []
  return Object.entries(p).map(([key, v]) => ({
    key,
    value: v === null ? 'null' : typeof v === 'number' && key === 'size_bytes' ? `${v} (${formatBytes(v)})` : String(v),
  }))
}
