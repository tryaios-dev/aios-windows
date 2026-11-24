import { create } from 'zustand'
import { errorCode, type AiosBridge } from '@aios/bridge-contract'
import { bridge } from '@/bridge'
import { api } from '@/lib/api'
import { useStore } from '@/lib/store'
import { catalogueEntry } from '@/data/catalogue'
import { GIB, WORKING_SPACE_BYTES } from './tiers'

/**
 * Setting up (test findings 4 to 6, 8): the work behind the step, started as soon as the person
 * presses Continue on "Your computer", and the real state of each part as the backend reports it.
 *
 * The work runs here, not in the screen, so going Back and forward never starts it twice, and the
 * AI model is already downloading when Setting up opens. Each part starts as soon as what it
 * needs is there, not before:
 *
 *   rules      the network rules are in force (GET /system/network)
 *   activity   the activity log's writer answers (GET /system/status)
 *   storage    the encrypted storage and its recovery key (POST /setup/store); the key waits,
 *              in memory only, for "Save your recovery key"
 *   project    the first project (POST /setup/project), once the storage is there
 *   voice      the speech model downloads (its state comes from GET /voice/status)
 *   download   the AI model downloads, or is copied from the installer package
 *   check      the AI model is checked (its state comes from the download)
 *   engine     the AI engine starts with the new model, once it is checked; the model becomes the
 *              one new conversations use
 *
 * Voice, download and check are not tracked here: the screen reads them from the backend's own
 * download states. This module keeps only what has no other home.
 */
export type RunStepId = 'rules' | 'activity' | 'storage' | 'project' | 'engine'
export type StepState = 'waiting' | 'running' | 'done' | 'failed'

export interface RunStep {
  state: StepState
  /** An error code from the backend, when it failed. */
  error?: string
}

export interface SetupRunState {
  started: boolean
  /** The AI model being set up; null once the person skips it. */
  entryId: string | null
  steps: Record<RunStepId, RunStep>
  /** The speech model download was asked for: the screen reads Voice's state again. */
  voiceAsked: boolean
}

const WAITING: Record<RunStepId, RunStep> = {
  rules: { state: 'waiting' },
  activity: { state: 'waiting' },
  storage: { state: 'waiting' },
  project: { state: 'waiting' },
  engine: { state: 'waiting' },
}

export const useSetupRun = create<SetupRunState>(() => ({ started: false, entryId: null, steps: { ...WAITING }, voiceAsked: false }))

export interface SetupDeps {
  bridge: () => AiosBridge
  /** Starts the AI model: the installer package first, else a download. */
  startModel: (entryId: string) => void
  pollMs?: number
  /** How long the activity log's writer may take to answer before its line says so. */
  writerWaitMs?: number
}

const DEFAULT_DEPS: SetupDeps = { bridge, startModel }
const POLL_MS = 1_000
const WRITER_WAIT_MS = 60_000

let deps: SetupDeps = DEFAULT_DEPS
let engineFor: string | null = null

function set(id: RunStepId, step: RunStep): void {
  useSetupRun.setState((s) => ({ steps: { ...s.steps, [id]: step } }))
}

async function step(id: RunStepId, work: () => Promise<void>): Promise<boolean> {
  set(id, { state: 'running' })
  try {
    await work()
    set(id, { state: 'done' })
    return true
  } catch (e) {
    set(id, { state: 'failed', error: errorCode(e) })
    return false
  }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Pressing Continue on "Your computer". Starts everything once; called again (after Back, or with
 * another AI model) it only changes the model.
 */
export function beginSetup(entryId: string | null, with_: SetupDeps = DEFAULT_DEPS): void {
  deps = with_
  chooseModel(entryId)
  if (useSetupRun.getState().started) return
  useSetupRun.setState({ started: true })
  const b = deps.bridge()
  const pollMs = deps.pollMs ?? POLL_MS

  const todo = (id: RunStepId) => useSetupRun.getState().steps[id].state !== 'done'

  if (todo('rules')) void step('rules', async () => {
    const hosts = await b.settings.network()
    if (!hosts.length) throw new Error('rules_not_loaded')
  })

  if (todo('activity')) void step('activity', async () => {
    const until = Date.now() + (deps.writerWaitMs ?? WRITER_WAIT_MS)
    // The writer may still be starting: the line stays "running" until it answers.
    while ((await b.system.status()).writer.state !== 'ok') {
      if (Date.now() > until) throw new Error('writer_unavailable')
      await wait(pollMs)
    }
  })

  void (async () => {
    const stored = !todo('storage') || (await step('storage', async () => {
      if ((await b.setup.status()).store_created) return
      const created = await b.setup.createStore()
      // Held for "Save your recovery key" in this window's memory, as before; never written anywhere.
      useStore.setState((st) => ({
        recoveryKey: created.recovery_key,
        stream: { ...st.stream, stream_id: created.stream_id, signer_key_id: created.signing_key_id },
      }))
    }))
    if (stored && todo('project')) await step('project', async () => void (await b.setup.createProject()))
  })()

  // Voice downloads beside the AI model. It never holds setup up: Settings, Voice offers it again.
  void b.voice
    .downloadModel()
    .catch(() => undefined)
    .finally(() => useSetupRun.setState({ voiceAsked: true }))

  // The engine starts the moment the AI model is installed (downloaded and checked).
  engineWatch = useStore.subscribe(engineWhenInstalled)
  engineWhenInstalled()
}

let engineWatch: (() => void) | null = null

function engineWhenInstalled(): void {
  const id = useSetupRun.getState().entryId
  if (id && useStore.getState().installedModels.some((m) => m.id === id)) startEngine(id)
}

/** The AI model to set up changed (Back, another size, or Skip): the earlier download stops. */
export function chooseModel(entryId: string | null): void {
  const before = useSetupRun.getState().entryId
  useSetupRun.setState({ entryId })
  const downloads = useStore.getState().downloads
  // During first run, every download is one setup started.
  for (const other of Object.keys(downloads)) {
    if (other === entryId) continue
    // Skipping keeps what has arrived; picking another size throws the first one away.
    if (entryId === null) {
      if (downloads[other].status === 'downloading') api.models.pause(other)
    } else api.models.cancel(other)
  }
  if (entryId && entryId !== before) {
    const s = useStore.getState()
    if (!s.installedModels.some((m) => m.id === entryId) && !s.downloads[entryId]) deps.startModel(entryId)
  }
  if (useSetupRun.getState().started) engineWhenInstalled()
}

/** Try the parts that failed again (rules, activity log, storage, project, engine). */
export function retrySetup(): void {
  const { steps, entryId } = useSetupRun.getState()
  const failed = (Object.keys(steps) as RunStepId[]).filter((id) => steps[id].state === 'failed')
  if (!failed.length) return
  if (failed.includes('engine')) engineFor = null
  useSetupRun.setState({ started: false, steps: { ...steps, ...Object.fromEntries(failed.map((id) => [id, { state: 'waiting' }])) } })
  engineWatch?.()
  beginSetup(entryId, deps)
}

/** Once the AI model is checked: it becomes the one new conversations use, and the engine starts with it. */
export function startEngine(entryId: string): void {
  if (engineFor === entryId) return
  engineFor = entryId
  void step('engine', async () => {
    api.models.setDefault(entryId)
    await deps.bridge().models.startEngine(entryId)
  })
}

/** For the AI model's two parts (download and check), from the backend's download state. */
async function startModel(entryId: string): Promise<void> {
  const entry = catalogueEntry(entryId)
  if (!entry) return
  // A model that came with the installer is used first: no download, no network (MVP 10.1).
  if (await api.models.installFromPackage(entryId)) return
  const hw = useStore.getState().hardware
  if (hw.free_disk_gb * GIB >= entry.size_bytes + WORKING_SPACE_BYTES) api.models.download(entryId)
}

/** Tests only: forget everything. */
export function resetSetupRun(): void {
  engineWatch?.()
  engineWatch = null
  deps = DEFAULT_DEPS
  engineFor = null
  useSetupRun.setState({ started: false, entryId: null, steps: { ...WAITING }, voiceAsked: false })
}
