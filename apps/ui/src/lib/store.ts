/**
 * App state (zustand). Everything in it comes from the backend through `@/bridge/live`, except the
 * interface's own state: toasts, the menu, the search palette, setup progress and which notices were
 * dismissed. Nothing here is sample data, and nothing here changes backend state: changes go through
 * `@/lib/api`, which calls the backend and reloads what it touched.
 */
import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import type {
  AllowlistEntry,
  Checkpoint,
  Classification,
  Conversation,
  DownloadState,
  EvidenceEvent,
  EvidenceStream,
  Generation,
  Hardware,
  Health,
  InstalledModel,
  Message,
  Project,
  ProviderType,
  Settings,
  SetupProgress,
  Summary,
  Toast,
  UpdateNotice,
} from './types'
import { uuid } from './hash'
import { catalogueEntry } from '@/data/catalogue'

/** What the backend reports about this installation. */
export interface LiveFacts {
  /** GET /system/network: every host AIOS may connect to. */
  allowlist: AllowlistEntry[]
  /** GET /system/info: open-source software and AI models in this build, with licences. */
  licences: Array<{ name: string; role: string; licence: string }>
  /** GET /health: the database exists but its key is gone (“cannot open your data”). */
  databaseLocked: boolean
}

/** Interface preferences kept between launches on this computer. Never data: that is the backend's. */
const STORAGE_KEY = 'aios-ui-v1'

interface Persisted {
  sidebarCollapsed: boolean
  lastProjectId: string | null
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
    /* storage unavailable: preferences last for this session only */
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
  /** Set when a company-server answer was interrupted mid-stream. */
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
  generation: Generation | null
  continueLocally: ContinueLocallyPrompt | null
  modelChoice: ModelChoicePrompt | null
  fallbackNotice: { at: string; dismissed: boolean } | null
  recoveryKey: string | null
  /** Shown once after an update installs or fails (M-18). */
  updateNotice: UpdateNotice | null
  toasts: Toast[]
  /** Facts the backend reports; null until it has answered. */
  live: LiveFacts | null
  ui: {
    /** Where the first-run wizard was when the app last closed. */
    setup: SetupProgress
    /** From the backend (GET /setup/status). */
    firstRunComplete: boolean
    sidebarCollapsed: boolean
    lastProjectId: string | null
    commandOpen: boolean
    /** Setup is running on an installation that never had data. */
    freshInstall: boolean
  }
}

export interface AppActions {
  answerContinueLocally: (accept: boolean) => void
  answerModelChoice: (modelId: string | null) => void
  dismissFallbackNotice: () => void
  dismissUpdateNotice: () => void
  /** Shown at once; the backend's answer (PATCH /settings) follows through `@/lib/api`. */
  setDefaultModel: (id: string | null) => void
  setSetupProgress: (patch: Partial<SetupProgress>) => void
  /** Setup starts again from its first step (the backend reports no finished setup). */
  resetFirstRun: () => void
  setSidebarCollapsed: (v: boolean) => void
  setLastProject: (id: string | null) => void
  setCommandOpen: (v: boolean) => void
  toast: (t: Omit<Toast, 'id'>) => void
  dismissToast: (id: string) => void
}

export type Store = AppState & AppActions

/** Before the backend has answered: empty, never invented. */
const EMPTY_HARDWARE: Hardware = { cpu: '', cores: 0, ram_gb: 0, free_disk_gb: 0, os: '', recommended_tier: null, recommended_entry_id: null }

const EMPTY_SETTINGS: Settings = {
  update_check: false,
  catalogue_check: false,
  safe_mode_cpu: false,
  default_model_id: null,
  last_update_check: null,
  last_catalogue_check: null,
  update_available: null,
  app_version: '',
  catalogue_version: '',
  schema_version: 0,
  backup_location: null,
  last_backup_at: null,
  last_backup_size: null,
  recovery_key_issued_at: null,
}

const EMPTY_HEALTH: Health = {
  backend: 'starting',
  engine: 'not_started',
  engine_build: 'cpu',
  loaded_model_id: null,
  writer: 'ok',
  evidence_pending: 0,
  company: { enabled: false, reachable: false, base_url: '', model_name: '' },
}

const EMPTY_STREAM: EvidenceStream = { stream_id: '', device_id: '', epoch: 0, signer_key_id: '', created_at: '' }

const CLASS_ORDER: Record<Classification, number> = { restricted: 0, internal: 1, public: 2 }
export function isLowering(from: Classification, to: Classification) {
  return CLASS_ORDER[to] > CLASS_ORDER[from]
}

/* ------------------------------------------------------------------ */
/* Store                                                                */
/* ------------------------------------------------------------------ */

export const useStore = create<Store>()((set, get) => {
  const persist = () => {
    const { ui } = get()
    savePersisted({ sidebarCollapsed: ui.sidebarCollapsed, lastProjectId: ui.lastProjectId, setup: ui.setup })
  }

  return {
    projects: [],
    conversations: [],
    messages: [],
    summaries: [],
    installedModels: [],
    downloads: {},
    hardware: EMPTY_HARDWARE,
    settings: EMPTY_SETTINGS,
    health: EMPTY_HEALTH,
    stream: EMPTY_STREAM,
    events: [],
    checkpoints: [],
    generation: null,
    continueLocally: null,
    modelChoice: null,
    fallbackNotice: null,
    recoveryKey: null,
    updateNotice: null,
    toasts: [],
    live: null,
    ui: {
      setup: persisted.setup ?? { step: 0, keyShownUnconfirmed: false },
      firstRunComplete: false,
      sidebarCollapsed: persisted.sidebarCollapsed ?? false,
      lastProjectId: persisted.lastProjectId ?? null,
      commandOpen: false,
      freshInstall: false,
    },

    // The backend has no prompts of these kinds yet; answering closes them.
    answerContinueLocally: () => set({ continueLocally: null }),
    answerModelChoice: () => set({ modelChoice: null }),
    dismissFallbackNotice: () => set((s) => ({ fallbackNotice: s.fallbackNotice ? { ...s.fallbackNotice, dismissed: true } : null })),
    dismissUpdateNotice: () => set({ updateNotice: null }),
    setDefaultModel: (id) => set((s) => ({ settings: { ...s.settings, default_model_id: id } })),
    setSetupProgress: (patch) => {
      set((s) => ({ ui: { ...s.ui, setup: { ...s.ui.setup, ...patch } } }))
      persist()
    },
    resetFirstRun: () => {
      set((s) => ({ ui: { ...s.ui, firstRunComplete: false, freshInstall: true, lastProjectId: null, setup: { step: 0, keyShownUnconfirmed: false } } }))
      persist()
    },
    setSidebarCollapsed: (v) => {
      set((s) => ({ ui: { ...s.ui, sidebarCollapsed: v } }))
      persist()
    },
    setLastProject: (id) => {
      set((s) => ({ ui: { ...s.ui, lastProjectId: id } }))
      persist()
    },
    setCommandOpen: (v) => set((s) => ({ ui: { ...s.ui, commandOpen: v } })),
    toast: (t) => {
      const id = uuid('toast')
      set((s) => ({ toasts: [...s.toasts.slice(-3), { ...t, id }] }))
      const ms = t.duration ?? (t.kind === 'deny' ? 9000 : 5500)
      setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), ms)
    },
    dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  }
})

export function useStoreShallow<T>(selector: (s: Store) => T): T {
  return useStore(useShallow(selector))
}

export const selectProject = (id: string | undefined) => (s: Store) => s.projects.find((p) => p.id === id)
export const selectConversation = (id: string | undefined) => (s: Store) => s.conversations.find((c) => c.id === id)
/** The company server's AI model, as the backend reports it. */
export const selectCompanyModelName = (s: Store) => s.health.company.model_name || 'the company server’s AI model'
export const selectModelName = (modelId: string | null | undefined, provider: ProviderType = 'local') => (s: Store) => {
  if (provider === 'company') return selectCompanyModelName(s)
  return s.installedModels.find((m) => m.id === modelId)?.name ?? catalogueEntry(modelId)?.name ?? 'No model'
}
const NO_HOSTS: AllowlistEntry[] = []
export const selectAllowlist = (s: Store): AllowlistEntry[] => s.live?.allowlist ?? NO_HOSTS
/** The size the backend suggests for this computer (GET /system/hardware); null below the minimum. */
export const selectRecommendedTier = (s: Store) => s.hardware.recommended_tier
/** The one AI model the backend suggests for this computer. */
export const selectRecommendedEntry = (s: Store): string | null => s.hardware.recommended_entry_id ?? null
