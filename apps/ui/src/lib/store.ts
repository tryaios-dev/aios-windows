/**
 * Application state and simulated backend for the AIOS MVP prototype.
 *
 * Reads: components select from this store.
 * Writes: components call the endpoint façade in `api.ts`, which maps the
 * MVP 9.3 local API onto the actions below. Developers replace `api.ts`
 * with preload-bridge calls; the state shape stays.
 */
import { create } from 'zustand'
import { modelLabel } from './words'
import { subscribeWithSelector } from 'zustand/middleware'
import { useShallow } from 'zustand/react/shallow'
import type {
  AllowlistEntry,
  BackupResult,
  CatalogueEntry,
  Checkpoint,
  Classification,
  Conversation,
  DownloadState,
  EvidenceEvent,
  EvidenceExportResult,
  EvidenceStream,
  EventType,
  ExportResult,
  Generation,
  Hardware,
  Health,
  ImportResult,
  InstalledModel,
  Message,
  Project,
  ProviderType,
  SearchHit,
  Settings,
  SetupProgress,
  UpdateNotice,
  Summary,
  Toast,
} from './types'
import { DEFAULT_SIM, type SimFlags } from './sim'
import { hashHex, uuid, ZERO_HASH } from './hash'
import { estimateTokens, truncate } from './format'
import { DEFAULT_HARDWARE, catalogueEntry, tierFor } from '@/data/catalogue'
import { pickAnswer, summaryFor } from '@/data/answers'
import {
  SEED_CHECKPOINTS,
  SEED_CONVERSATIONS,
  SEED_DEFAULT_PROJECT_ID,
  SEED_EVENTS,
  SEED_INSTALLED_MODELS,
  SEED_MESSAGES,
  SEED_PROJECTS,
  SEED_STREAM,
  SEED_SUMMARIES,
} from '@/data/seed'
import { platform } from '@/lib/platform'

/* ------------------------------------------------------------------ */
/* Constants                                                            */
/* ------------------------------------------------------------------ */

export const COMPANY_MODEL_ID = 'company:qwen3-32b'
export const COMPANY_MODEL_NAME = 'Qwen3 32B'
export const COMPANY_BASE_URL = 'https://ai.internal.example.com'
export const APP_VERSION = '0.9.4'
export const MAX_ANSWER_TOKENS = 1500
export const SYSTEM_PROMPT_TOKENS = 220
const IDLE_UNLOAD_MS = 5 * 60 * 1000
const DEMO_RECOVERY_KEY = 'K7QX-3MWP-9RTA-5HNV-2BCD-8FJL-4SYE-6ZUG'

export const ALLOWLIST_FIXED: AllowlistEntry[] = [
  // AI models come directly from their publisher (12 November 2026). AIOS checks each file before using it.
  { host: 'huggingface.co', purpose: 'AI models you install, downloaded directly from their publisher', kind: 'fixed', enabled: true },
  { host: 'updates.aios.eu.com', purpose: 'Signed update feed (at start, at most once a day)', kind: 'fixed', enabled: true },
]

const STORAGE_KEY = 'aios-prototype-v1'

interface Persisted {
  sim: SimFlags
  firstRunComplete: boolean
  sidebarCollapsed: boolean
  lastProjectId: string | null
  freshInstall: boolean
  setup: SetupProgress
}

function loadPersisted(): Partial<Persisted> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Partial<Persisted>) : {}
  } catch {
    return {}
  }
}

function savePersisted(p: Persisted) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p))
  } catch {
    /* storage unavailable: the prototype still works for this session */
  }
}

const persisted = loadPersisted()

/* ------------------------------------------------------------------ */
/* State shape                                                          */
/* ------------------------------------------------------------------ */

export interface ContinueLocallyPrompt {
  conversation_id: string
  /** The text the user tried to send, kept so nothing is lost. */
  pending_text?: string
  /** Set when a Company answer was interrupted mid-stream. */
  partial_message_id?: string
}

export interface ModelChoicePrompt {
  conversation_id: string
  deleted_model_name: string
  pending_text: string
}

export interface AppState {
  projects: Project[]
  conversations: Conversation[]
  messages: Message[]
  summaries: Summary[]
  installedModels: InstalledModel[]
  downloads: Record<string, DownloadState>
  hardware: Hardware
  settings: Settings
  health: Health
  stream: EvidenceStream
  events: EvidenceEvent[]
  checkpoints: Checkpoint[]
  sim: SimFlags
  generation: Generation | null
  continueLocally: ContinueLocallyPrompt | null
  modelChoice: ModelChoicePrompt | null
  fallbackNotice: { at: string; dismissed: boolean } | null
  recoveryKey: string | null
  /** Shown once after an update installs or fails (M-18). */
  updateNotice: UpdateNotice | null
  toasts: Toast[]
  ui: {
    /** Where the first-run wizard was when the app last closed. */
    setup: SetupProgress
    firstRunComplete: boolean
    sidebarCollapsed: boolean
    lastProjectId: string | null
    commandOpen: boolean
    freshInstall: boolean
  }
}

export interface AppActions {
  /* projects */
  createProject: (input: { name: string; classification: Classification }) => Project
  renameProject: (id: string, name: string) => void
  archiveProject: (id: string, archived: boolean) => void
  deleteProject: (id: string) => void
  reclassifyProject: (id: string, to: Classification) => { project: Project; reviewedCopy: boolean }
  setProjectCompanyAi: (id: string, enabled: boolean, confirmed: boolean) => void
  /* conversations */
  createConversation: (projectId: string, title?: string) => Conversation
  renameConversation: (id: string, title: string) => void
  archiveConversation: (id: string, archived: boolean) => void
  deleteConversation: (id: string) => void
  setConversationModel: (id: string, modelId: string) => void
  moveConversation: (id: string, to: ProviderType, confirmed: boolean) => void
  /* chat */
  sendMessage: (conversationId: string, text: string) => { ok: true } | { ok: false; reason: 'no_model' | 'too_large' | 'busy' | 'company_unreachable' | 'model_missing'; detail?: string }
  stopGeneration: () => void
  regenerate: (conversationId: string) => void
  answerContinueLocally: (accept: boolean) => void
  offerContinueLocally: (conversationId: string, partialMessageId: string) => void
  answerModelChoice: (modelId: string | null) => void
  dismissFallbackNotice: () => void
  /* search */
  search: (q: string) => SearchHit[]
  /* models */
  startDownload: (entryId: string) => void
  pauseDownload: (entryId: string) => void
  resumeDownload: (entryId: string) => void
  cancelDownload: (entryId: string) => void
  importModel: (entryId: string) => void
  deleteModel: (id: string) => { ok: true } | { ok: false; reason: string }
  setDefaultModel: (id: string | null) => void
  /* settings and system */
  updateSettings: (patch: Partial<Settings>) => void
  checkForUpdates: () => Promise<void>
  installUpdate: () => void
  dismissUpdateNotice: () => void
  /* backup (decision D3) and recovery key (D4) */
  setBackupLocation: (path: string | null) => void
  backupNow: () => Promise<{ ok: true; result: BackupResult } | { ok: false; error: string }>
  reissueRecoveryKey: () => string
  setSetupProgress: (patch: Partial<SetupProgress>) => void
  runBenchmark: () => Promise<void>
  /* export and import */
  exportProject: (projectId: string) => Promise<ExportResult>
  importProject: () => Promise<{ ok: true; result: ImportResult } | { ok: false; error: string }>
  exportEvidence: (scope: { project_id: string } | { from: string; to: string }) => Promise<EvidenceExportResult>
  /* recovery and first run */
  restore: (input: { backup_path: string; recovery_key: string; has_package: boolean }) => Promise<{ ok: true; epoch: number } | { ok: false; error: string }>
  issueRecoveryKey: () => string
  completeFirstRun: (input: { installedModelId: string | null }) => void
  resetFirstRun: (mode: 'replay' | 'fresh') => void
  /* sim */
  setSim: (patch: Partial<SimFlags>) => void
  resetPrototype: () => void
  /* ui */
  setSidebarCollapsed: (v: boolean) => void
  setLastProject: (id: string | null) => void
  setCommandOpen: (v: boolean) => void
  toast: (t: Omit<Toast, 'id'>) => void
  dismissToast: (id: string) => void
  /* internal */
  _appendEvent: (draft: EventDraft) => EvidenceEvent
  _touchEngine: () => void
}

export type Store = AppState & AppActions

interface EventDraft {
  event_type: EventType
  actor: EvidenceEvent['actor']
  project_id?: string
  conversation_id?: string
  provider?: ProviderType
  model_digest?: string
  input?: string
  output?: string
  payload?: EvidenceEvent['payload']
}

/* ------------------------------------------------------------------ */
/* Initial state builders                                               */
/* ------------------------------------------------------------------ */

function initialHealth(sim: SimFlags, installed: InstalledModel[], defaultModel: string | null, safeMode: boolean): Health {
  const hasModel = installed.length > 0 && !!defaultModel
  return {
    backend: 'ok',
    engine: hasModel ? 'ready' : 'no_model',
    engine_build: safeMode || sim.slowMachine ? 'cpu' : 'vulkan',
    loaded_model_id: hasModel ? defaultModel : null,
    writer: sim.writerAvailable ? 'ok' : 'unavailable',
    evidence_pending: 0,
    company: { enabled: sim.companyFlag, reachable: sim.companyReachable, base_url: COMPANY_BASE_URL, model_name: COMPANY_MODEL_NAME },
  }
}

function initialSettings(defaultModel: string | null, sim: SimFlags): Settings {
  return {
    update_check: true,
    catalogue_check: true,
    safe_mode_cpu: false,
    default_model_id: defaultModel,
    last_update_check: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
    last_catalogue_check: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
    update_available: sim.updateAvailable ? { version: '0.9.5', size_bytes: 212_000_000 } : null,
    app_version: APP_VERSION,
    catalogue_version: '2026.10.2',
    schema_version: 7,
    backup_location: defaultModel && !sim.neverBackedUp ? 'E:\\AIOS backups' : null,
    last_backup_at: defaultModel && !sim.neverBackedUp ? new Date(Date.now() - 3 * 86400000 - 2 * 3600000).toISOString() : null,
    last_backup_size: defaultModel && !sim.neverBackedUp ? 23_600_000 : null,
    recovery_key_issued_at: defaultModel ? new Date(Date.now() - 19 * 86400000).toISOString() : null,
  }
}

function hardwareFor(sim: SimFlags): Hardware {
  if (sim.slowMachine) {
    const hw: Hardware = {
      cpu: 'Intel Core i5-1135G7',
      cores: 4,
      ram_gb: 8,
      gpu: undefined,
      free_disk_gb: 41,
      os: 'Windows 11 Home 24H2 (build 26100)',
      recommended_tier: 'small',
      benchmark: { model_id: 'qwen3-4b-q4km', engine: 'cpu', tokens_per_second: 9.6, time_to_first_token_ms: 4_200, run_at: new Date(Date.now() - 12 * 86400000).toISOString() },
    }
    return hw
  }
  return {
    ...DEFAULT_HARDWARE,
    benchmark: { model_id: 'qwen3-8b-q4km', engine: 'vulkan', tokens_per_second: 38.4, time_to_first_token_ms: 420, run_at: new Date(Date.now() - 19 * 86400000).toISOString() },
  }
}

function seededState(sim: SimFlags, fresh: boolean): Omit<AppState, 'sim' | 'ui' | 'toasts'> {
  if (fresh) {
    const now = new Date().toISOString()
    const defaultProject: Project = {
      id: uuid('default'),
      name: 'My workspace',
      classification: 'restricted',
      classification_source: 'project',
      company_ai_enabled: false,
      archived: false,
      created_at: now,
      updated_at: now,
    }
    const stream: EvidenceStream = { stream_id: hashHex(`stream|${now}`, 128), device_id: 'win-7f3a9c2e', epoch: 1, signer_key_id: hashHex(`signer|${now}`), created_at: now }
    return {
      projects: [defaultProject],
      conversations: [],
      messages: [],
      summaries: [],
      installedModels: [],
      downloads: {},
      hardware: hardwareFor(sim),
      settings: initialSettings(null, sim),
      health: initialHealth(sim, [], null, false),
      stream,
      events: [],
      checkpoints: [],
      generation: null,
      continueLocally: null,
      modelChoice: null,
      fallbackNotice: null,
      recoveryKey: null,
      updateNotice: null,
    }
  }
  const defaultModel = SEED_INSTALLED_MODELS[0].id
  return {
    projects: SEED_PROJECTS.map((p) => ({ ...p })),
    conversations: SEED_CONVERSATIONS.map((c) => ({ ...c })),
    messages: SEED_MESSAGES.map((m) => ({ ...m })),
    summaries: SEED_SUMMARIES.map((s) => ({ ...s })),
    installedModels: SEED_INSTALLED_MODELS.map((m) => ({ ...m })),
    downloads: {},
    hardware: hardwareFor(sim),
    settings: initialSettings(defaultModel, sim),
    health: initialHealth(sim, SEED_INSTALLED_MODELS, defaultModel, false),
    stream: { ...SEED_STREAM },
    events: SEED_EVENTS.map((e) => ({ ...e })),
    checkpoints: SEED_CHECKPOINTS.map((c) => ({ ...c })),
    generation: null,
    continueLocally: null,
    modelChoice: null,
    fallbackNotice: null,
    recoveryKey: null,
    updateNotice: null,
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const nowIso = () => new Date().toISOString()

function tokenise(text: string): string[] {
  // Words with trailing whitespace, so streaming looks like real token output.
  return text.match(/\S+\s*|\s+/g) ?? [text]
}

function previewOf(text: string) {
  return truncate(text.replace(/[#*`>|\-\[\]]/g, ''), 140)
}

const CLASS_ORDER: Record<Classification, number> = { restricted: 0, internal: 1, public: 2 }
export function isLowering(from: Classification, to: Classification) {
  return CLASS_ORDER[to] > CLASS_ORDER[from]
}

export function contextBudget(contextLength: number) {
  return contextLength - MAX_ANSWER_TOKENS - SYSTEM_PROMPT_TOKENS
}

/* ------------------------------------------------------------------ */
/* Store                                                                */
/* ------------------------------------------------------------------ */

let abortCurrent: (() => void) | null = null
let idleTimer: ReturnType<typeof setTimeout> | null = null
/** Full canned answer per assistant message, so a local continuation can resume where a partial stopped. */
const fullAnswers = new Map<string, string>()
const downloadTimers: Record<string, ReturnType<typeof setInterval>> = {}
const verifyTimers: Record<string, ReturnType<typeof setTimeout>> = {}

export const useStore = create<Store>()(
  subscribeWithSelector((set, get) => {
    const sim: SimFlags = { ...DEFAULT_SIM, ...(persisted.sim ?? {}) }
    const fresh = !!persisted.freshInstall && !persisted.firstRunComplete
    const base = seededState(sim, fresh)

    const persist = () => {
      const s = get()
      savePersisted({ sim: s.sim, firstRunComplete: s.ui.firstRunComplete, sidebarCollapsed: s.ui.sidebarCollapsed, lastProjectId: s.ui.lastProjectId, freshInstall: s.ui.freshInstall, setup: s.ui.setup })
    }

    const patchHealth = (patch: Partial<Health>) => set((s) => ({ health: { ...s.health, ...patch } }))
    const patchMessage = (id: string, patch: Partial<Message> | ((m: Message) => Partial<Message>)) =>
      set((s) => ({ messages: s.messages.map((m) => (m.id === id ? { ...m, ...(typeof patch === 'function' ? patch(m) : patch) } : m)) }))
    const patchConversation = (id: string, patch: Partial<Conversation>) =>
      set((s) => ({ conversations: s.conversations.map((c) => (c.id === id ? { ...c, ...patch, updated_at: patch.updated_at ?? c.updated_at } : c)) }))
    const patchProject = (id: string, patch: Partial<Project>) =>
      set((s) => ({ projects: s.projects.map((p) => (p.id === id ? { ...p, ...patch, updated_at: nowIso() } : p)) }))

    const toast = (t: Omit<Toast, 'id'>) => {
      const id = uuid('toast')
      set((s) => ({ toasts: [...s.toasts.slice(-3), { ...t, id }] }))
      const ms = t.duration ?? (t.kind === 'deny' ? 9000 : 5500)
      setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), ms)
    }

    const appendEvent = (d: EventDraft): EvidenceEvent => {
      const s = get()
      const pending = !s.sim.writerAvailable
      const prevHash = s.events.length ? s.events[s.events.length - 1].event_hash : s.stream.prior_tip_hash ?? ZERO_HASH
      const seq = (s.events.length ? s.events[s.events.length - 1].seq : 0) + 1
      const event: EvidenceEvent = {
        seq,
        format_version: 1,
        stream_id: s.stream.stream_id,
        epoch: s.stream.epoch,
        ts: nowIso(),
        event_type: d.event_type,
        actor: d.actor,
        project_id: d.project_id,
        conversation_id: d.conversation_id,
        provider: d.provider,
        model_digest: d.model_digest,
        input_commitment: d.input ? hashHex(`aios-input-v1\n${d.input}`) : undefined,
        output_commitment: d.output ? hashHex(`aios-output-v1\n${d.output}`) : undefined,
        prev_hash: prevHash,
        event_hash: '',
        payload: d.payload,
        pending,
      }
      const { event_hash: _omit, pending: _p, ...rest } = event
      event.event_hash = hashHex(`aios-evidence-v1\n${JSON.stringify(rest, Object.keys(rest).sort())}`)
      set((st) => ({ events: [...st.events, event], health: { ...st.health, evidence_pending: st.health.evidence_pending + (pending ? 1 : 0) } }))
      return event
    }

    const flushPending = () => {
      const s = get()
      if (!s.sim.writerAvailable) return
      if (!s.events.some((e) => e.pending)) return
      set((st) => ({
        events: st.events.map((e) => (e.pending ? { ...e, pending: false } : e)),
        messages: st.messages.map((m) => (m.evidence_pending ? { ...m, evidence_pending: false } : m)),
        health: { ...st.health, evidence_pending: 0 },
      }))
      toast({ kind: 'success', title: 'Activity recording has caught up', description: 'Everything that happened while it was paused is now in the record.' })
    }

    const scheduleIdleUnload = () => {
      if (idleTimer) clearTimeout(idleTimer)
      idleTimer = setTimeout(() => {
        const s = get()
        if (s.health.engine === 'ready') patchHealth({ engine: 'idle_unloaded' })
      }, IDLE_UNLOAD_MS)
    }

    /** Drives one streamed answer. Handles engine load, preparing context, GPU fallback, interruption. */
    const runGeneration = async (conversationId: string, assistantId: string, prompt: string, isRegenerate: boolean, answerOverride?: string) => {
      let aborted = false
      let dropped = false
      abortCurrent = () => {
        aborted = true
      }

      const s0 = get()
      const conv = s0.conversations.find((c) => c.id === conversationId)!
      const provider = conv.current_provider
      const cpu = s0.health.engine_build === 'cpu'

      set({ generation: { conversation_id: conversationId, message_id: assistantId, phase: 'loading_engine', provider } })

      if (provider === 'local') {
        // Engine lifecycle: load on demand, crash and fall back if simulated.
        if (get().health.engine !== 'ready' || get().health.loaded_model_id !== conv.model_id) {
          patchHealth({ engine: 'loading', loaded_model_id: conv.model_id })
          await sleep(cpu ? 1800 : 1100)
          if (aborted) return finish('stopped')
        }
        if (get().sim.engineCrashNext && get().health.engine_build === 'vulkan') {
          patchHealth({ engine: 'failed' })
          await sleep(900)
          set((st) => ({ sim: { ...st.sim, engineCrashNext: false }, fallbackNotice: { at: nowIso(), dismissed: false } }))
          persist()
          patchHealth({ engine: 'loading', engine_build: 'cpu' })
          toast({ kind: 'caution', title: 'AIOS switched to a slower, more reliable mode', description: 'Your graphics card stopped responding, so AIOS is using your processor. Answers are slower until you restart AIOS.', action: { label: 'Open Compatibility mode', href: '/settings/computer' } })
          await sleep(1600)
          if (aborted) return finish('stopped')
        }
        patchHealth({ engine: 'ready' })
      }

      // Preparing context: long history on CPU, or any long history when the machine is slow.
      const history = get().messages.filter((m) => m.conversation_id === conversationId)
      const historyChars = history.reduce((n, m) => n + m.content.length, 0)
      const longHistory = historyChars > 7000 || history.length > 8
      if (provider === 'local' && longHistory && (get().health.engine_build === 'cpu' || get().sim.slowMachine)) {
        set({ generation: { conversation_id: conversationId, message_id: assistantId, phase: 'preparing', provider } })
        patchMessage(assistantId, { preparing: true })
        await sleep(2200)
        patchMessage(assistantId, { preparing: false })
        if (aborted) return finish('stopped')
      } else {
        await sleep(provider === 'company' ? 700 : get().health.engine_build === 'cpu' ? 1400 : 380)
        if (aborted) return finish('stopped')
      }

      set({ generation: { conversation_id: conversationId, message_id: assistantId, phase: 'streaming', provider } })
      patchHealth({ engine: provider === 'local' ? 'generating' : get().health.engine })

      const answer = answerOverride ?? pickAnswer(prompt)
      fullAnswers.set(assistantId, answer)
      const tokens = tokenise(answer)
      const perTick = provider === 'company' ? 18 : get().health.engine_build === 'cpu' ? 85 : 26
      const dropAt = provider === 'company' && get().sim.dropNextCompanyAnswer ? Math.floor(tokens.length * 0.42) : -1
      let content = ''
      for (let i = 0; i < tokens.length; i++) {
        if (aborted) break
        if (i === dropAt) {
          dropped = true
          break
        }
        content += tokens[i]
        patchMessage(assistantId, { content })
        await sleep(perTick + (i % 7 === 0 ? 14 : 0))
      }

      function finish(status: Message['status']) {
        const st = get()
        set({ generation: null })
        abortCurrent = null
        const msg = st.messages.find((m) => m.id === assistantId)
        const convNow = st.conversations.find((c) => c.id === conversationId)
        if (!msg || !convNow) {
          if (st.health.engine === 'generating' || st.health.engine === 'loading') patchHealth({ engine: 'ready' })
          return
        }
        const entry = convNow.current_provider === 'company' ? undefined : catalogueEntry(convNow.model_id)
        const completion = estimateTokens(msg.content)
        patchMessage(assistantId, { status, completion_tokens: completion, prompt_tokens: estimateTokens(prompt) + SYSTEM_PROMPT_TOKENS, preparing: false })
        patchConversation(conversationId, { updated_at: nowIso(), last_message_preview: previewOf(msg.content || prompt) })
        patchProject(convNow.project_id, {})
        if (msg.content.length > 0 || status === 'stopped') {
          const ev = appendEvent({
            event_type: 'request',
            actor: 'user',
            project_id: convNow.project_id,
            conversation_id: conversationId,
            provider: convNow.current_provider,
            model_digest: entry?.artifact_digest ?? hashHex(`company|${COMPANY_MODEL_ID}`),
            input: `ctx:${assistantId}:${prompt}`,
            output: msg.content,
            payload: { prompt_tokens: estimateTokens(prompt) + SYSTEM_PROMPT_TOKENS, completion_tokens: completion, status, regenerate: isRegenerate, runtime: convNow.current_provider === 'company' ? 'vllm 0.11' : `llama-server b6471 ${get().health.engine_build}` },
          })
          patchMessage(assistantId, { evidence_seq: ev.seq, evidence_pending: ev.pending })
        }
        if (convNow.current_provider === 'local') {
          patchHealth({ engine: 'ready' })
          scheduleIdleUnload()
        }
        maybeSummarise(conversationId)
      }

      if (dropped) {
        set((st) => ({ sim: { ...st.sim, dropNextCompanyAnswer: false } }))
        persist()
        patchHealth({ company: { ...get().health.company, reachable: false } })
        finish('partial')
        patchMessage(assistantId, { continuation_offered: true })
        set({ continueLocally: { conversation_id: conversationId, partial_message_id: assistantId } })
        toast({ kind: 'caution', title: 'The connection to the company server dropped', description: 'The answer is saved as far as it got. You can continue on this computer.' })
        return
      }
      finish(aborted ? 'stopped' : 'complete')
    }

    const maybeSummarise = (conversationId: string) => {
      const s = get()
      const msgs = s.messages.filter((m) => m.conversation_id === conversationId)
      const chars = msgs.reduce((n, m) => n + m.content.length, 0)
      const existing = s.summaries.find((x) => x.conversation_id === conversationId)
      const coveredIdx = existing ? msgs.findIndex((m) => m.id === existing.covers_until_message_id) : -1
      const uncovered = msgs.slice(coveredIdx + 1)
      const uncoveredChars = uncovered.reduce((n, m) => n + m.content.length, 0)
      if (chars < 9000 || uncoveredChars < 6000) return
      const conv = s.conversations.find((c) => c.id === conversationId)!
      setTimeout(() => {
        const st = get()
        const current = st.messages.filter((m) => m.conversation_id === conversationId)
        if (!current.length || !st.conversations.some((c) => c.id === conversationId)) return
        const covers = current[Math.max(0, current.length - 4)]
        const summary: Summary = {
          id: uuid('summary'),
          conversation_id: conversationId,
          covers_until_message_id: covers.id,
          content: summaryFor(conv.title),
          classification_effective: conv.classification_effective,
          classification_source: conv.classification_source,
          model_id: conv.current_provider === 'company' ? COMPANY_MODEL_ID : conv.model_id ?? '',
          provider: conv.current_provider,
          created_at: nowIso(),
        }
        set((x) => ({ summaries: [...x.summaries.filter((y) => y.conversation_id !== conversationId), summary] }))
        const entry = catalogueEntry(conv.model_id)
        appendEvent({ event_type: 'request', actor: 'app', project_id: conv.project_id, conversation_id: conversationId, provider: conv.current_provider, model_digest: entry?.artifact_digest, input: `summary:${summary.id}`, output: summary.content, payload: { purpose: 'summary', covers_until: covers.id } })
      }, 2500)
    }

    return {
      ...base,
      sim,
      toasts: [],
      ui: {
        firstRunComplete: persisted.firstRunComplete ?? true,
        sidebarCollapsed: persisted.sidebarCollapsed ?? false,
        lastProjectId: persisted.lastProjectId ?? (fresh ? base.projects[0].id : SEED_DEFAULT_PROJECT_ID),
        commandOpen: false,
        freshInstall: fresh,
        setup: persisted.setup ?? { step: 0, keyShownUnconfirmed: false },
      },

      /* ---------------- projects ---------------- */
      createProject: ({ name, classification }) => {
        const now = nowIso()
        const project: Project = { id: uuid('project'), name: name.trim() || 'Untitled project', classification, classification_source: 'project', company_ai_enabled: false, archived: false, created_at: now, updated_at: now }
        set((s) => ({ projects: [project, ...s.projects] }))
        appendEvent({ event_type: 'project_created', actor: 'user', project_id: project.id, payload: { classification } })
        return project
      },
      renameProject: (id, name) => patchProject(id, { name: name.trim() || 'Untitled project' }),
      archiveProject: (id, archived) => patchProject(id, { archived }),
      deleteProject: (id) => {
        const s = get()
        if (s.generation && s.conversations.find((c) => c.id === s.generation!.conversation_id)?.project_id === id) abortCurrent?.()
        const convIds = s.conversations.filter((c) => c.project_id === id).map((c) => c.id)
        set((st) => ({
          projects: st.projects.filter((p) => p.id !== id),
          conversations: st.conversations.filter((c) => c.project_id !== id),
          messages: st.messages.filter((m) => !convIds.includes(m.conversation_id)),
          summaries: st.summaries.filter((x) => !convIds.includes(x.conversation_id)),
          ui: { ...st.ui, lastProjectId: st.ui.lastProjectId === id ? null : st.ui.lastProjectId },
        }))
        appendEvent({ event_type: 'project_deleted', actor: 'user', project_id: id, payload: { conversations: convIds.length } })
      },
      reclassifyProject: (id, to) => {
        const s = get()
        const original = s.projects.find((p) => p.id === id)!
        if (original.classification === to) return { project: original, reviewedCopy: false }
        if (!isLowering(original.classification, to)) {
          patchProject(id, { classification: to })
          appendEvent({ event_type: 'project_reclassified', actor: 'user', project_id: id, payload: { from_class: original.classification, to_class: to, in_place: true } })
          return { project: get().projects.find((p) => p.id === id)!, reviewedCopy: false }
        }
        // Lowering: reviewed copy with provenance; the original is untouched.
        const now = nowIso()
        const label = to === 'internal' ? 'Internal' : 'Public'
        const copy: Project = { id: uuid('copy'), name: `${original.name} (${label} copy)`, classification: to, classification_source: 'review', derived_from_project_id: original.id, company_ai_enabled: false, archived: false, created_at: now, updated_at: now }
        const convs = s.conversations.filter((c) => c.project_id === id)
        const newConvs: Conversation[] = []
        const newMsgs: Message[] = []
        const newSums: Summary[] = []
        for (const c of convs) {
          const nc: Conversation = { ...c, id: uuid('conv'), project_id: copy.id, classification_effective: to, classification_source: 'review', created_at: now, updated_at: now, moves: undefined }
          newConvs.push(nc)
          for (const m of s.messages.filter((x) => x.conversation_id === c.id)) newMsgs.push({ ...m, id: uuid('msg'), conversation_id: nc.id, classification_effective: to, classification_source: 'review', evidence_seq: undefined, evidence_pending: false })
          for (const x of s.summaries.filter((y) => y.conversation_id === c.id)) newSums.push({ ...x, id: uuid('sum'), conversation_id: nc.id, classification_effective: to, classification_source: 'review' })
        }
        set((st) => ({ projects: [copy, ...st.projects], conversations: [...st.conversations, ...newConvs], messages: [...st.messages, ...newMsgs], summaries: [...st.summaries, ...newSums] }))
        appendEvent({ event_type: 'project_reclassified', actor: 'user', project_id: copy.id, payload: { from_class: original.classification, to_class: to, derived_from_project_id: original.id, reviewed_copy: true, conversations: convs.length } })
        return { project: copy, reviewedCopy: true }
      },
      setProjectCompanyAi: (id, enabled, confirmed) => {
        if (enabled && !confirmed) throw new Error('Enabling Company AI requires confirmation')
        patchProject(id, { company_ai_enabled: enabled })
        appendEvent({ event_type: 'provider_changed', actor: 'user', project_id: id, provider: enabled ? 'company' : 'local', payload: { scope: 'project_default', enabled } })
      },

      /* ---------------- conversations ---------------- */
      createConversation: (projectId, title) => {
        const s = get()
        const project = s.projects.find((p) => p.id === projectId)!
        const useCompany = s.sim.companyFlag && project.company_ai_enabled && s.sim.companyReachable
        const now = nowIso()
        const conv: Conversation = {
          id: uuid('conv'),
          project_id: projectId,
          title: title?.trim() || 'New conversation',
          classification_effective: project.classification,
          classification_source: project.classification_source === 'review' ? 'review' : 'project',
          provider_mode: useCompany ? 'company' : 'local',
          current_provider: useCompany ? 'company' : 'local',
          model_id: useCompany ? COMPANY_MODEL_ID : s.settings.default_model_id,
          archived: false,
          created_at: now,
          updated_at: now,
        }
        set((st) => ({ conversations: [conv, ...st.conversations] }))
        patchProject(projectId, {})
        return conv
      },
      renameConversation: (id, title) => patchConversation(id, { title: title.trim() || 'Untitled conversation', updated_at: nowIso() }),
      archiveConversation: (id, archived) => patchConversation(id, { archived, updated_at: nowIso() }),
      deleteConversation: (id) => {
        if (get().generation?.conversation_id === id) abortCurrent?.()
        fullAnswers.clear()
        const conv = get().conversations.find((c) => c.id === id)
        set((st) => ({ conversations: st.conversations.filter((c) => c.id !== id), messages: st.messages.filter((m) => m.conversation_id !== id), summaries: st.summaries.filter((x) => x.conversation_id !== id) }))
        if (conv) appendEvent({ event_type: 'conversation_deleted', actor: 'user', project_id: conv.project_id, conversation_id: id })
      },
      setConversationModel: (id, modelId) => patchConversation(id, { model_id: modelId }),
      moveConversation: (id, to, confirmed) => {
        const s = get()
        const conv = s.conversations.find((c) => c.id === id)!
        if (conv.current_provider === to) return
        if (to === 'company') {
          if (!s.sim.companyFlag) throw new Error('Company provider is not enabled on this installation')
          if (!confirmed) throw new Error('Moving to Company requires confirmation')
        }
        const at = nowIso()
        patchConversation(id, { current_provider: to, provider_mode: to, model_id: to === 'company' ? COMPANY_MODEL_ID : s.settings.default_model_id, moves: [...(conv.moves ?? []), { to, at }], updated_at: at })
        appendEvent({ event_type: 'provider_changed', actor: 'user', project_id: conv.project_id, conversation_id: id, provider: to, payload: { from: conv.current_provider, to, history_sent: to === 'company' } })
      },

      /* ---------------- chat ---------------- */
      sendMessage: (conversationId, text) => {
        const s = get()
        if (s.generation) return { ok: false, reason: 'busy' }
        const conv = s.conversations.find((c) => c.id === conversationId)
        if (!conv) return { ok: false, reason: 'busy' }
        const clean = text.trim()
        if (!clean) return { ok: false, reason: 'busy' }

        if (conv.current_provider === 'local') {
          if (s.installedModels.length === 0) return { ok: false, reason: 'no_model' }
          const model = s.installedModels.find((m) => m.id === conv.model_id)
          if (!model) {
            const name = catalogueEntry(conv.model_id)?.name ?? 'The model this conversation used'
            set({ modelChoice: { conversation_id: conversationId, deleted_model_name: name, pending_text: clean } })
            return { ok: false, reason: 'model_missing', detail: name }
          }
          const budget = contextBudget(model.context_length)
          const needed = estimateTokens(clean)
          if (needed > budget) {
            appendEvent({ event_type: 'refusal', actor: 'app', project_id: conv.project_id, conversation_id: conversationId, provider: 'local', payload: { reason: 'message_too_large', tokens: needed, budget } })
            return { ok: false, reason: 'too_large', detail: 'Try sending it in two parts.' }
          }
        } else if (!s.sim.companyReachable || !s.health.company.reachable) {
          set({ continueLocally: { conversation_id: conversationId, pending_text: clean } })
          return { ok: false, reason: 'company_unreachable' }
        }

        const now = nowIso()
        const userMsg: Message = { id: uuid('msg'), conversation_id: conversationId, role: 'user', content: clean, classification_effective: conv.classification_effective, classification_source: conv.classification_source, status: 'complete', provider: conv.current_provider, model_id: conv.model_id, prompt_tokens: 0, completion_tokens: 0, created_at: now }
        const assistant: Message = { id: uuid('msg'), conversation_id: conversationId, role: 'assistant', content: '', classification_effective: conv.classification_effective, classification_source: conv.classification_source, status: 'streaming', provider: conv.current_provider, model_id: conv.model_id, prompt_tokens: 0, completion_tokens: 0, created_at: new Date(Date.now() + 1).toISOString() }
        set((st) => ({ messages: [...st.messages, userMsg, assistant] }))
        const isFirst = s.messages.filter((m) => m.conversation_id === conversationId).length === 0
        patchConversation(conversationId, { updated_at: now, last_message_preview: previewOf(clean), title: isFirst && conv.title === 'New conversation' ? truncate(clean, 48) : conv.title })
        void runGeneration(conversationId, assistant.id, clean, false)
        return { ok: true }
      },
      stopGeneration: () => {
        abortCurrent?.()
      },
      regenerate: (conversationId) => {
        const s = get()
        if (s.generation) return
        const msgs = s.messages.filter((m) => m.conversation_id === conversationId)
        const last = msgs[msgs.length - 1]
        const prompt = [...msgs].reverse().find((m) => m.role === 'user')
        if (!last || last.role !== 'assistant' || !prompt) return
        patchMessage(last.id, (m) => ({ previous_versions: [...(m.previous_versions ?? []), m.content], content: '', status: 'streaming', evidence_seq: undefined, evidence_pending: false, continuation_offered: false, created_at: nowIso() }))
        void runGeneration(conversationId, last.id, prompt.content, true)
      },
      offerContinueLocally: (conversationId, partialMessageId) => set({ continueLocally: { conversation_id: conversationId, partial_message_id: partialMessageId } }),
      answerContinueLocally: (accept) => {
        const p = get().continueLocally
        set({ continueLocally: null })
        if (!p || !accept) return
        // Moving to Local never asks and needs no flag.
        get().moveConversation(p.conversation_id, 'local', true)
        if (p.pending_text) get().sendMessage(p.conversation_id, p.pending_text)
        else if (p.partial_message_id) {
          // Resume the interrupted answer on the local model as a new answer; no synthetic user message.
          const st = get()
          const msgs = st.messages.filter((m) => m.conversation_id === p.conversation_id)
          const partial = msgs.find((m) => m.id === p.partial_message_id)
          const prompt = [...msgs].reverse().find((m) => m.role === 'user')
          const conv = st.conversations.find((c) => c.id === p.conversation_id)
          if (!partial || !prompt || !conv || st.generation) return
          const full = fullAnswers.get(partial.id) ?? pickAnswer(prompt.content)
          const remainder = full.startsWith(partial.content) ? full.slice(partial.content.length).replace(/^\s+/, '') : full
          const assistant: Message = { id: uuid('msg'), conversation_id: conv.id, role: 'assistant', content: '', classification_effective: conv.classification_effective, classification_source: conv.classification_source, status: 'streaming', provider: 'local', model_id: conv.model_id, prompt_tokens: 0, completion_tokens: 0, created_at: nowIso(), continued_from: partial.id }
          set((x) => ({ messages: [...x.messages, assistant] }))
          patchMessage(partial.id, { continuation_offered: false })
          void runGeneration(conv.id, assistant.id, prompt.content, false, remainder || full)
        }
      },
      answerModelChoice: (modelId) => {
        const p = get().modelChoice
        set({ modelChoice: null })
        if (!p || !modelId) return
        patchConversation(p.conversation_id, { model_id: modelId })
        get().sendMessage(p.conversation_id, p.pending_text)
      },
      dismissFallbackNotice: () => set((s) => ({ fallbackNotice: s.fallbackNotice ? { ...s.fallbackNotice, dismissed: true } : null })),

      /* ---------------- search ---------------- */
      search: (q) => {
        const query = q.trim().toLowerCase()
        if (query.length < 2) return []
        const s = get()
        const hits: SearchHit[] = []
        for (const m of s.messages) {
          const idx = m.content.toLowerCase().indexOf(query)
          if (idx < 0) continue
          const conv = s.conversations.find((c) => c.id === m.conversation_id)
          if (!conv) continue
          const start = Math.max(0, idx - 70)
          const end = Math.min(m.content.length, idx + query.length + 90)
          const snippet = `${start > 0 ? '…' : ''}${m.content.slice(start, end).replace(/\*\*|__|`|^\s*#+\s|^\s*>\s?|-\s\[[ x]\]\s?|\|/gm, ' ').replace(/\s+/g, ' ').trim()}${end < m.content.length ? '…' : ''}`
          hits.push({ message_id: m.id, conversation_id: conv.id, project_id: conv.project_id, snippet, created_at: m.created_at, role: m.role })
        }
        return hits.sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 60)
      },

      /* ---------------- models ---------------- */
      startDownload: (entryId) => {
        const entry = catalogueEntry(entryId)
        if (!entry) return
        const s = get()
        if (s.downloads[entryId]?.status === 'downloading') return
        const needed = entry.size_bytes + 2 * 1024 ** 3
        if (s.hardware.free_disk_gb * 1024 ** 3 < needed) {
          toast({ kind: 'deny', title: 'Not enough free space', description: `This AI model needs ${(needed / 1024 ** 3).toFixed(0)} GB free. This computer has ${s.hardware.free_disk_gb} GB. Free some space and try again.` })
          return
        }
        set((st) => ({ downloads: { ...st.downloads, [entryId]: { entry_id: entryId, status: 'downloading', received_bytes: st.downloads[entryId]?.received_bytes ?? 0, total_bytes: entry.size_bytes, speed_bps: 0, started_at: nowIso() } } }))
        runDownload(entryId)
      },
      pauseDownload: (entryId) => {
        clearInterval(downloadTimers[entryId])
        set((st) => (st.downloads[entryId] ? { downloads: { ...st.downloads, [entryId]: { ...st.downloads[entryId], status: 'paused', speed_bps: 0 } } } : st))
      },
      resumeDownload: (entryId) => {
        set((st) => ({ downloads: { ...st.downloads, [entryId]: { ...st.downloads[entryId], status: 'downloading', error: undefined } } }))
        runDownload(entryId)
      },
      cancelDownload: (entryId) => {
        clearInterval(downloadTimers[entryId])
        clearTimeout(verifyTimers[entryId])
        set((st) => {
          const d = { ...st.downloads }
          delete d[entryId]
          return { downloads: d }
        })
      },
      importModel: (entryId) => {
        const entry = catalogueEntry(entryId)
        if (!entry) return
        set((st) => ({ downloads: { ...st.downloads, [entryId]: { entry_id: entryId, status: 'verifying', received_bytes: entry.size_bytes, total_bytes: entry.size_bytes, speed_bps: 0, started_at: nowIso() } } }))
        verifyTimers[entryId] = setTimeout(() => installFromEntry(entry, 'offline'), 2200)
      },
      deleteModel: (id) => {
        const s = get()
        if (s.generation && s.generation.provider === 'local') return { ok: false, reason: 'The AI is writing an answer. Wait for it to finish, or stop it, then remove the model.' }
        const model = s.installedModels.find((m) => m.id === id)
        if (!model) return { ok: false, reason: 'That AI model is not installed.' }
        const remaining = s.installedModels.filter((m) => m.id !== id)
        const nextDefault = s.settings.default_model_id === id ? (remaining[0]?.id ?? null) : s.settings.default_model_id
        set((st) => ({
          installedModels: remaining,
          settings: { ...st.settings, default_model_id: nextDefault },
          health: { ...st.health, loaded_model_id: st.health.loaded_model_id === id ? null : st.health.loaded_model_id, engine: remaining.length === 0 ? 'no_model' : st.health.loaded_model_id === id ? 'idle_unloaded' : st.health.engine },
          hardware: { ...st.hardware, free_disk_gb: Math.round(st.hardware.free_disk_gb + model.size_bytes / 1024 ** 3) },
        }))
        appendEvent({ event_type: 'model_deleted', actor: 'user', model_digest: model.artifact_digest, payload: { entry_id: model.catalogue_entry_id, size_bytes: model.size_bytes } })
        return { ok: true }
      },
      setDefaultModel: (id) => set((st) => ({ settings: { ...st.settings, default_model_id: id } })),

      /* ---------------- settings ---------------- */
      updateSettings: (patch) => {
        set((st) => ({ settings: { ...st.settings, ...patch } }))
        if (patch.safe_mode_cpu !== undefined) {
          patchHealth({ engine_build: patch.safe_mode_cpu ? 'cpu' : get().sim.slowMachine ? 'cpu' : 'vulkan', engine: get().installedModels.length ? 'idle_unloaded' : 'no_model' })
        }
      },
      checkForUpdates: async () => {
        await sleep(1400)
        set((st) => ({ settings: { ...st.settings, last_update_check: nowIso(), last_catalogue_check: nowIso(), update_available: st.sim.updateAvailable ? { version: '0.9.5', size_bytes: 212_000_000 } : null } }))
      },
      dismissUpdateNotice: () => set({ updateNotice: null }),
      setBackupLocation: (path) => set((st) => ({ settings: { ...st.settings, backup_location: path } })),
      backupNow: async () => {
        const s0 = get()
        const location = s0.settings.backup_location
        if (!location) return { ok: false, error: 'Choose where backups go first.' }
        if (s0.generation) return { ok: false, error: 'An answer is being written. Wait for it to finish, then back up.' }
        await sleep(2200)
        if (get().sim.failNextBackup) {
          set((st) => ({ sim: { ...st.sim, failNextBackup: false } }))
          persist()
          return { ok: false, error: `AIOS could not reach ${location}. Check the drive is connected, then try again. Nothing was changed.` }
        }
        const s = get()
        const at = nowIso()
        const size = 24_000_000 + s.messages.reduce((n, m) => n + m.content.length, 0) * 3 + s.events.length * 900
        const stamp = at.slice(0, 10)
        const result: BackupResult = { path: `${location}\\AIOS backup ${stamp}`, size_bytes: Math.round(size), at, conversations: s.conversations.length }
        set((st) => ({ settings: { ...st.settings, last_backup_at: at, last_backup_size: result.size_bytes }, sim: { ...st.sim, neverBackedUp: false } }))
        persist()
        // Assumption: a backup is recorded as an export event with kind "backup"; the wire format has no dedicated type.
        appendEvent({ event_type: 'export', actor: 'user', payload: { kind: 'backup', size_bytes: result.size_bytes, conversations: result.conversations, models_included: false } })
        return { ok: true, result }
      },
      reissueRecoveryKey: () => {
        const key = get().issueRecoveryKey()
        set((st) => ({ settings: { ...st.settings, recovery_key_issued_at: nowIso() } }))
        appendEvent({ event_type: 'recovery_key_issued', actor: 'user', payload: { reissued: true } })
        return key
      },
      setSetupProgress: (patch) => {
        set((st) => ({ ui: { ...st.ui, setup: { ...st.ui.setup, ...patch } } }))
        persist()
      },
      installUpdate: () => {
        const version = get().settings.update_available?.version ?? ''
        if (get().sim.failNextUpdate) {
          set((st) => ({ sim: { ...st.sim, failNextUpdate: false }, updateNotice: { kind: 'failed', version } }))
          persist()
          return
        }
        set((st) => ({ updateNotice: { kind: 'installed', version }, settings: { ...st.settings, app_version: version || st.settings.app_version, update_available: null }, sim: { ...st.sim, updateAvailable: false } }))
        persist()
      },
      runBenchmark: async () => {
        await sleep(2600)
        set((st) => ({ hardware: { ...st.hardware, benchmark: { model_id: st.settings.default_model_id ?? 'qwen3-8b-q4km', engine: st.health.engine_build, tokens_per_second: st.health.engine_build === 'cpu' ? 9.2 + Math.random() : 36 + Math.random() * 5, time_to_first_token_ms: st.health.engine_build === 'cpu' ? 3900 + Math.round(Math.random() * 600) : 380 + Math.round(Math.random() * 90), run_at: nowIso() } } }))
      },

      /* ---------------- export and import ---------------- */
      exportProject: async (projectId) => {
        await sleep(1500)
        const s = get()
        const project = s.projects.find((p) => p.id === projectId)!
        const convs = s.conversations.filter((c) => c.project_id === projectId)
        const msgs = s.messages.filter((m) => convs.some((c) => c.id === m.conversation_id))
        const slug = project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
        const size = 4096 + msgs.reduce((n, m) => n + m.content.length, 0) * 1.1
        const ev = appendEvent({ event_type: 'export', actor: 'user', project_id: projectId, payload: { kind: 'project_package', package_version: 1, conversations: convs.length, messages: msgs.length } })
        return { file_name: `${slug}.aiosproj`, size_bytes: Math.round(size), path: `C:\\Users\\pilot\\Documents\\AIOS exports\\${slug}.aiosproj`, checksum: hashHex(`pkg|${projectId}|${ev.seq}`), evidence_seq: ev.seq }
      },
      importProject: async () => {
        await sleep(1800)
        const s = get()
        if (s.sim.failNextImport) {
          set((st) => ({ sim: { ...st.sim, failNextImport: false } }))
          persist()
          return { ok: false, error: 'This file is damaged or was changed after it was saved. Nothing was added. Ask for the project to be saved as a file again.' }
        }
        const now = nowIso()
        const nameBase = 'Supplier FAQ'
        const collision = s.projects.some((p) => p.name.startsWith(nameBase))
        const project: Project = { id: uuid('import'), name: collision ? `${nameBase} (from a file)` : nameBase, classification: 'internal', classification_source: 'import', company_ai_enabled: false, archived: false, created_at: now, updated_at: now }
        const titles = ['Payment terms questions', 'Onboarding a new supplier', 'Escalation contacts']
        const convs: Conversation[] = titles.map((t) => ({ id: uuid('iconv'), project_id: project.id, title: t, classification_effective: 'internal', classification_source: 'import', provider_mode: 'local', current_provider: 'local', model_id: s.settings.default_model_id, archived: false, created_at: now, updated_at: now, last_message_preview: 'Added from a project file made on another computer.' }))
        const msgs: Message[] = convs.flatMap((c) => [
          { id: uuid('imsg'), conversation_id: c.id, role: 'user' as const, content: `What should I know about ${c.title.toLowerCase()}?`, classification_effective: 'internal' as const, classification_source: 'import' as const, status: 'complete' as const, provider: 'local' as const, model_id: 'qwen3-8b-q4km', prompt_tokens: 230, completion_tokens: 0, created_at: now },
          { id: uuid('imsg'), conversation_id: c.id, role: 'assistant' as const, content: pickAnswer(c.title), classification_effective: 'internal' as const, classification_source: 'import' as const, status: 'complete' as const, provider: 'local' as const, model_id: 'qwen3-8b-q4km', prompt_tokens: 230, completion_tokens: 310, created_at: now },
        ])
        set((st) => ({ projects: [project, ...st.projects], conversations: [...convs, ...st.conversations], messages: [...st.messages, ...msgs] }))
        appendEvent({ event_type: 'import', actor: 'user', project_id: project.id, payload: { package_version: 1, conversations: convs.length, messages: msgs.length, remapped: collision, warnings: 1 } })
        return { ok: true, result: { project_id: project.id, project_name: project.name, conversations: convs.length, messages: msgs.length, summaries: 0, warnings: ['One item in the file was not recognised and was left out.'], remapped: collision } }
      },
      exportEvidence: async (scope) => {
        await sleep(1700)
        const s = get()
        let events = s.events
        let label = ''
        if ('project_id' in scope) {
          const projectEvents = events.filter((e) => e.project_id === scope.project_id || e.project_id === undefined)
          const first = projectEvents[0]?.seq ?? events[0]?.seq ?? 1
          const last = projectEvents[projectEvents.length - 1]?.seq ?? events[events.length - 1]?.seq ?? 1
          events = events.filter((e) => e.seq >= first && e.seq <= last)
          label = `project ${s.projects.find((p) => p.id === scope.project_id)?.name ?? scope.project_id}`
        } else {
          events = events.filter((e) => e.ts >= scope.from && e.ts <= scope.to)
          label = `date range ${scope.from.slice(0, 10)} to ${scope.to.slice(0, 10)}`
        }
        const first = events[0]?.seq ?? 0
        const last = events[events.length - 1]?.seq ?? 0
        const cps = s.checkpoints.filter((c) => c.seq_to >= first && c.seq_from <= last)
        const ev = appendEvent({ event_type: 'export', actor: 'user', project_id: 'project_id' in scope ? scope.project_id : undefined, payload: { kind: 'evidence', scope: label, first_seq: first, last_seq: last, checkpoints: cps.length } })
        const epochs = events.map((e) => e.epoch)
        return {
          file_name: `evidence-${s.stream.stream_id.slice(0, 8)}-${first}-${last}.zip`,
          path: `C:\\Users\\pilot\\Documents\\AIOS exports\\evidence-${s.stream.stream_id.slice(0, 8)}-${first}-${last}.zip`,
          size_bytes: 1800 + events.length * 640,
          stream_id: s.stream.stream_id,
          epoch_range: [Math.min(...epochs, s.stream.epoch), Math.max(...epochs, s.stream.epoch)],
          first_seq: first,
          last_seq: last,
          expected_tip: events[events.length - 1]?.event_hash ?? ZERO_HASH,
          signer_key_ids: Array.from(new Set([s.stream.signer_key_id, ...(s.stream.prior_tip_hash ? [hashHex('signer-key-epoch-1')] : [])])),
          checkpoint_ids: cps.map((c) => c.id),
          custody: 'Self-custodied Local, no anchor',
          exported_at: ev.ts,
          scope: label,
        }
      },

      /* ---------------- recovery and first run ---------------- */
      restore: async ({ backup_path, recovery_key, has_package }) => {
        await sleep(900)
        if (!has_package) return { ok: false, error: 'That folder is not a complete AIOS backup. Choose the folder AIOS made when you backed up. Nothing was changed.' }
        const key = recovery_key.replace(/\s+/g, '').toUpperCase()
        const accepted = [DEMO_RECOVERY_KEY, get().recoveryKey ?? ''].map((k) => k.replace(/-/g, '')).filter(Boolean)
        await sleep(1400)
        if (!accepted.includes(key.replace(/-/g, ''))) return { ok: false, error: 'That recovery key does not open this backup. Check it character by character. Nothing was changed.' }
        await sleep(1600)
        const s = get()
        const tip = s.events.length ? s.events[s.events.length - 1].event_hash : ZERO_HASH
        const oldSigner = s.stream.signer_key_id
        const newEpoch = s.stream.epoch + 1
        const newSigner = hashHex(`signer|epoch-${newEpoch}|${backup_path}`)
        set((st) => ({ stream: { ...st.stream, epoch: newEpoch, signer_key_id: newSigner, prior_tip_hash: tip }, sim: { ...st.sim, keysMissing: false }, ui: { ...st.ui, firstRunComplete: true, freshInstall: false, setup: { step: 0, keyShownUnconfirmed: false } } }))
        appendEvent({ event_type: 'restore', actor: 'user', payload: { backup_path, restored_tip: tip, package_version: 1 } })
        appendEvent({ event_type: 'continuation', actor: 'app', payload: { old_signer_key_id: oldSigner, new_signer_key_id: newSigner, prior_tip_hash: tip, epoch: newEpoch } })
        persist()
        return { ok: true, epoch: newEpoch }
      },
      issueRecoveryKey: () => {
        const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
        const groups: string[] = []
        for (let g = 0; g < 8; g++) {
          let s = ''
          for (let i = 0; i < 4; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)]
          groups.push(s)
        }
        const key = groups.join('-')
        set({ recoveryKey: key })
        return key
      },
      completeFirstRun: ({ installedModelId }) => {
        const s = get()
        if (s.ui.freshInstall) {
          appendEvent({ event_type: 'install', actor: 'app', payload: { app_version: APP_VERSION, installer: platform.installer } })
          appendEvent({ event_type: 'store_created', actor: 'app', payload: { schema_version: 7 } })
          appendEvent({ event_type: 'recovery_package_written', actor: 'app', payload: { package_version: 1 } })
          appendEvent({ event_type: 'recovery_key_issued', actor: 'app' })
          if (installedModelId) {
            const entry = catalogueEntry(installedModelId)
            if (entry && !s.installedModels.some((m) => m.id === installedModelId)) installFromEntry(entry, 'download', true)
          }
          appendEvent({ event_type: 'project_created', actor: 'app', project_id: s.projects[0].id, payload: { classification: 'restricted', default: true } })
        }
        set((st) => ({ settings: { ...st.settings, recovery_key_issued_at: st.settings.recovery_key_issued_at ?? nowIso() }, ui: { ...st.ui, firstRunComplete: true, lastProjectId: st.projects[0]?.id ?? null, setup: { step: 0, keyShownUnconfirmed: false } } }))
        persist()
      },
      resetFirstRun: (mode) => {
        abortCurrent?.()
        for (const t of Object.values(downloadTimers)) clearInterval(t)
        for (const t of Object.values(verifyTimers)) clearTimeout(t)
        fullAnswers.clear()
        const simNow = get().sim
        const freshNow = mode === 'fresh'
        const next = seededState(simNow, freshNow)
        set({ ...next, ui: { ...get().ui, firstRunComplete: false, freshInstall: freshNow, lastProjectId: next.projects[0]?.id ?? null, setup: { step: 0, keyShownUnconfirmed: false } }, toasts: [] })
        persist()
        window.dispatchEvent(new CustomEvent('aios:reset', { detail: { fresh: freshNow } }))
      },

      /* ---------------- sim ---------------- */
      setSim: (patch) => {
        set((st) => ({ sim: { ...st.sim, ...patch } }))
        const s = get()
        const h: Partial<Health> = {
          writer: s.sim.writerAvailable ? 'ok' : 'unavailable',
          company: { ...s.health.company, enabled: s.sim.companyFlag, reachable: s.sim.companyReachable },
        }
        if (patch.slowMachine !== undefined) {
          set({ hardware: hardwareFor(s.sim) })
          h.engine_build = s.sim.slowMachine || s.settings.safe_mode_cpu ? 'cpu' : 'vulkan'
        }
        if (patch.neverBackedUp !== undefined) set((st) => ({ settings: { ...st.settings, last_backup_at: patch.neverBackedUp ? null : new Date(Date.now() - 3 * 86400000).toISOString(), last_backup_size: patch.neverBackedUp ? null : 23_600_000, backup_location: patch.neverBackedUp ? null : (st.settings.backup_location ?? 'E:\\AIOS backups') } }))
        if (patch.updateAvailable !== undefined) set((st) => ({ settings: { ...st.settings, update_available: patch.updateAvailable ? { version: '0.9.5', size_bytes: 212_000_000 } : null } }))
        patchHealth(h)
        if (patch.writerAvailable) flushPending()
        persist()
      },
      resetPrototype: () => {
        abortCurrent?.()
        for (const t of Object.values(downloadTimers)) clearInterval(t)
        for (const t of Object.values(verifyTimers)) clearTimeout(t)
        fullAnswers.clear()
        const next = seededState(DEFAULT_SIM, false)
        set({ ...next, sim: { ...DEFAULT_SIM }, ui: { firstRunComplete: true, sidebarCollapsed: false, lastProjectId: SEED_DEFAULT_PROJECT_ID, commandOpen: false, freshInstall: false, setup: { step: 0, keyShownUnconfirmed: false } }, toasts: [] })
        window.dispatchEvent(new CustomEvent('aios:reset', { detail: { fresh: false } }))
        persist()
      },

      /* ---------------- ui ---------------- */
      setSidebarCollapsed: (v) => {
        set((st) => ({ ui: { ...st.ui, sidebarCollapsed: v } }))
        persist()
      },
      setLastProject: (id) => {
        set((st) => ({ ui: { ...st.ui, lastProjectId: id } }))
        persist()
      },
      setCommandOpen: (v) => set((st) => ({ ui: { ...st.ui, commandOpen: v } })),
      toast,
      dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

      _appendEvent: appendEvent,
      _touchEngine: scheduleIdleUnload,
    }

    /* ---------------- download simulation ---------------- */
    function runDownload(entryId: string) {
      clearInterval(downloadTimers[entryId])
      const entry = catalogueEntry(entryId)!
      // Faster than most real connections so a review does not take minutes, slow
      // enough that every stage of the progress display can be read.
      const baseSpeed = get().sim.slowMachine ? 30_000_000 : 105_000_000
      // The rate drifts the way a real connection does instead of jumping about.
      let drift = 0
      downloadTimers[entryId] = setInterval(() => {
        const st = get()
        const d = st.downloads[entryId]
        if (!d || d.status !== 'downloading') {
          clearInterval(downloadTimers[entryId])
          return
        }
        drift = Math.max(-0.22, Math.min(0.22, drift + (Math.random() - 0.5) * 0.08))
        const speed = baseSpeed * (1 + drift)
        const next = Math.min(d.total_bytes, d.received_bytes + speed * 0.25)
        const ratio = next / d.total_bytes
        if (st.sim.failNextDownload && ratio >= 0.6) {
          clearInterval(downloadTimers[entryId])
          set((x) => ({ sim: { ...x.sim, failNextDownload: false }, downloads: { ...x.downloads, [entryId]: { ...d, status: 'failed', speed_bps: 0, received_bytes: next, error_kind: 'connection', error: 'The connection dropped. The download will carry on from where it stopped.' } } }))
          persist()
          return
        }
        if (next >= d.total_bytes) {
          clearInterval(downloadTimers[entryId])
          set((x) => ({ downloads: { ...x.downloads, [entryId]: { ...d, status: 'verifying', received_bytes: d.total_bytes, speed_bps: 0 } } }))
          verifyTimers[entryId] = setTimeout(() => {
            if (get().sim.failNextVerify) {
              // The file failed its check: remove it and say so. The next attempt starts from zero.
              set((x) => ({ sim: { ...x.sim, failNextVerify: false }, downloads: { ...x.downloads, [entryId]: { ...x.downloads[entryId], status: 'failed', received_bytes: 0, speed_bps: 0, error_kind: 'damaged', error: 'The file was damaged or changed on the way. AIOS removed it.' } } }))
              persist()
              return
            }
            installFromEntry(entry, 'download')
          }, 2600)
          return
        }
        set((x) => ({ downloads: { ...x.downloads, [entryId]: { ...d, received_bytes: next, speed_bps: speed } } }))
      }, 250)
    }

    function installFromEntry(entry: CatalogueEntry, source: InstalledModel['source'], silent = false) {
      if (!silent && get().downloads[entry.entry_id]?.status !== 'verifying') return
      const model: InstalledModel = { id: entry.entry_id, catalogue_entry_id: entry.entry_id, name: entry.name, file_path: `${platform.folders.models}${entry.file_name}`, artifact_digest: entry.artifact_digest, size_bytes: entry.size_bytes, context_length: entry.context_length, licence: entry.licence, tier: entry.tier, installed_at: nowIso(), source }
      set((st) => {
        const d = { ...st.downloads }
        delete d[entry.entry_id]
        const installed = st.installedModels.some((m) => m.id === model.id) ? st.installedModels : [...st.installedModels, model]
        const defaultModel = st.settings.default_model_id ?? model.id
        return {
          downloads: d,
          installedModels: installed,
          settings: { ...st.settings, default_model_id: defaultModel },
          health: { ...st.health, engine: st.health.engine === 'no_model' ? 'idle_unloaded' : st.health.engine },
          hardware: { ...st.hardware, free_disk_gb: Math.max(0, Math.round(st.hardware.free_disk_gb - entry.size_bytes / 1024 ** 3)) },
        }
      })
      appendEvent({ event_type: 'model_installed', actor: 'user', model_digest: entry.artifact_digest, payload: { entry_id: entry.entry_id, source, size_bytes: entry.size_bytes, provenance: entry.pipeline === 'own' ? 'own pipeline' : 'third-party, deviation approved' } })
      // Setup shows this result on its own screen; a toast over it would say the same thing twice.
      if (!silent && get().ui.firstRunComplete) toast({ kind: 'success', title: `${modelLabel(entry)} is installed`, description: 'Checked: genuine, unmodified file.' })
    }
  }),
)

/* ------------------------------------------------------------------ */
/* Selectors                                                            */
/* ------------------------------------------------------------------ */

/**
 * Use this for any selector that returns a NEW array or object (filter, map,
 * object literals). Plain useStore would re-render forever on a fresh reference.
 */
export function useStoreShallow<T>(selector: (s: Store) => T): T {
  return useStore(useShallow(selector))
}

export const selectProject = (id: string | undefined) => (s: Store) => s.projects.find((p) => p.id === id)
export const selectConversation = (id: string | undefined) => (s: Store) => s.conversations.find((c) => c.id === id)
export const selectModelName = (modelId: string | null | undefined, provider: ProviderType = 'local') => (s: Store) => {
  if (provider === 'company') return COMPANY_MODEL_NAME
  return s.installedModels.find((m) => m.id === modelId)?.name ?? catalogueEntry(modelId)?.name ?? 'No model'
}
const COMPANY_ENTRY_ON: AllowlistEntry = { host: new URL(COMPANY_BASE_URL).host, purpose: 'Company AI server (configured by an operator, only while the provider flag is on)', kind: 'configured', enabled: true }
const COMPANY_ENTRY_OFF: AllowlistEntry = { ...COMPANY_ENTRY_ON, enabled: false }
const ALLOWLIST_ON: AllowlistEntry[] = [...ALLOWLIST_FIXED, COMPANY_ENTRY_ON]
const ALLOWLIST_OFF: AllowlistEntry[] = [...ALLOWLIST_FIXED, COMPANY_ENTRY_OFF]
/** Stable references so selectors never produce fresh objects on every call. */
export const selectAllowlist = (s: Store): AllowlistEntry[] => (s.sim.companyFlag ? ALLOWLIST_ON : ALLOWLIST_OFF)
export const selectRecommendedTier = (s: Store) => tierFor(s.hardware)
