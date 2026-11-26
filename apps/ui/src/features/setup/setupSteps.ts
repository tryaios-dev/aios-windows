import type { VignetteKind } from '@/components/app/Vignettes'
import type { RunStep, RunStepId } from './setupRun'

/**
 * The lines of Setting up, worked out from what the backend reports and nothing else (test
 * findings 4 and 5), with the design's eight parts in the design's order. A line shows once its
 * part has started (the AI model's from the start); the title names a line that is running; the
 * counter counts the ticked lines; the percentage covers every part and reads 100 only when all
 * of them are settled.
 *
 * Document reading and memory have no work of their own: the reader is built in and the
 * summaries of long conversations are kept in the storage, so both are ready the moment the
 * encrypted storage is. The knowledge base is the first project plus the knowledge list
 * answering from the new storage. The AI engine starts once the model is checked, but has no line
 * and holds nothing up: chat starts it anyway when needed.
 */
export type LineId = 'storage' | 'documents' | 'knowledge' | 'voice' | 'memory' | 'rules' | 'activity' | 'model'
export type LineState = 'waiting' | 'current' | 'paused' | 'done' | 'failed' | 'skipped'

interface LineText {
  name: string
  /** While it runs. */
  adding: string
  /** Once done. */
  ready: string
  detail: string
  why: string
  drawing: VignetteKind
  /** Its share of the percentage: the downloads are the long jobs. */
  weight: number
  /** Setup can finish without it (it can be added later). */
  optional?: boolean
}

export const LINES: Record<LineId, LineText> = {
  storage: { name: 'Secure storage', adding: 'Setting up secure storage', ready: 'Secure storage is ready', detail: 'Everything is encrypted on this computer', why: 'Everything AIOS keeps is locked on this computer, and only you hold the key.', drawing: 'storage', weight: 2 },
  documents: { name: 'Document reading', adding: 'Adding document reading', ready: 'Document reading is ready', detail: 'AIOS can take in your PDFs and files', why: 'Drop in PDFs, Word files and spreadsheets, and your AI can work from them.', drawing: 'documents', weight: 1 },
  knowledge: { name: 'Knowledge base', adding: 'Preparing your knowledge base', ready: 'Your knowledge base is ready', detail: 'One protected place for the documents you add', why: 'The documents you add are kept together in one protected place, ready for your AI to use.', drawing: 'knowledge', weight: 1 },
  voice: { name: 'Voice', adding: 'Adding voice', ready: 'Voice is ready', detail: 'Speak instead of typing', why: 'Talk to your AI instead of typing, and turn recordings into text.', drawing: 'voice', weight: 3, optional: true },
  memory: { name: 'Memory', adding: 'Turning on memory', ready: 'Memory is on', detail: 'Your AI keeps track of what was said earlier', why: 'Your AI keeps track of long conversations, so you do not have to repeat yourself.', drawing: 'memory', weight: 1 },
  rules: { name: 'Rules', adding: 'Turning on the rules', ready: 'Rules are on', detail: 'Nothing leaves this computer unless you say so', why: 'Built-in rules decide what your AI may do. The first: nothing leaves this computer unless you say so.', drawing: 'rules', weight: 1 },
  activity: { name: 'Activity log', adding: 'Starting the activity log', ready: 'Activity log is on', detail: 'You can see everything your AI does', why: 'Every action is written down in plain words, in order, so you can always see what your AI did.', drawing: 'activity', weight: 1 },
  model: { name: 'AI model', adding: 'Downloading your AI model', ready: 'Your AI model is downloaded and checked', detail: '', why: 'The AI itself. It runs on this computer and keeps working with no internet.', drawing: 'model', weight: 22 },
}

export const ORDER: LineId[] = ['storage', 'documents', 'knowledge', 'voice', 'memory', 'rules', 'activity', 'model']

export interface Line {
  id: LineId
  state: LineState
  title: string
  detail?: string
  /** The detail is a running figure. */
  live?: boolean
}

/** The AI model as the backend reports it (download state, installed models). */
export type ModelState = 'adding' | 'copying' | 'checking' | 'paused' | 'dropped' | 'damaged' | 'no-space' | 'skipped' | 'ready'

export interface Facts {
  run: Record<RunStepId, RunStep>
  model: ModelState
  /** Download figures while it downloads ("64 MB of 1.5 GB · …"), the model's name otherwise. */
  modelDetail: string
  /** 0 to 1. */
  modelFraction: number
  /** null: this build has no speech engine. */
  voice: { state: 'waiting' | 'downloading' | 'checking' | 'ready' | 'failed'; fraction: number; detail?: string } | null
}

const RUN_STATE: Record<RunStep['state'], LineState> = { waiting: 'waiting', running: 'current', done: 'done', failed: 'failed' }

function lineFor(id: LineId, f: Facts): Line | null {
  const text = LINES[id]
  const plain = (state: LineState, detail?: string): Line => ({ id, state, title: state === 'done' ? text.ready : text.adding, detail: detail ?? (state === 'done' ? text.detail : undefined) })
  const fromRun = (step: RunStep) => plain(RUN_STATE[step.state], step.state === 'failed' ? 'It did not start. Try again.' : undefined)
  switch (id) {
    case 'storage':
    case 'knowledge':
    case 'rules':
    case 'activity':
      return fromRun(f.run[id])
    case 'documents':
    case 'memory':
      // Built in; they need only the encrypted storage.
      return plain(f.run.storage.state === 'done' ? 'done' : 'waiting')
    case 'voice': {
      const v = f.voice
      if (!v) return null
      if (v.state === 'ready') return plain('done')
      if (v.state === 'failed') return { id, state: 'failed', title: 'Voice was not downloaded', detail: 'You can add it later in Settings, Voice' }
      if (v.state === 'checking') return { id, state: 'current', title: 'Checking the speech model', detail: 'Making sure it is the genuine, unmodified file' }
      return { id, state: v.state === 'waiting' ? 'waiting' : 'current', title: text.adding, detail: v.detail, live: v.state === 'downloading' }
    }
    case 'model': {
      const m = f.model
      if (m === 'skipped') return { id, state: 'skipped', title: 'No AI model for now', detail: 'You can add one later from AI models' }
      if (m === 'ready') return { id, state: 'done', title: text.ready, detail: f.modelDetail }
      if (m === 'checking') return { id, state: 'current', title: 'Checking your AI model', detail: 'Making sure it is the genuine, unmodified file' }
      if (m === 'damaged') return { id, state: 'failed', title: 'The AI model did not pass its check', detail: 'AIOS removed it. Nothing from it was kept' }
      if (m === 'copying') return { id, state: 'current', title: 'Copying your AI model', detail: f.modelDetail }
      if (m === 'paused') return { id, state: 'paused', title: 'Download paused', detail: f.modelDetail }
      if (m === 'dropped') return { id, state: 'failed', title: 'The connection dropped', detail: f.modelDetail }
      if (m === 'no-space') return { id, state: 'failed', title: 'Not enough free space for the AI model', detail: f.modelDetail }
      return { id, state: 'current', title: text.adding, detail: f.modelDetail, live: true }
    }
  }
}

export interface Progress {
  lines: Line[]
  /** The line the title names: one that is running, else the first that needs the person. */
  featured: LineId | null
  ready: number
  total: number
  /** 0 to 100; 100 only when everything is settled. */
  percent: number
  finished: boolean
}

const SETTLED: LineState[] = ['done', 'skipped']

/** How far the AI model is: the download is most of it, the check the rest. */
function modelShare(f: Facts): number {
  if (f.model === 'checking') return 0.95
  return 0.9 * f.modelFraction
}

export function progress(f: Facts): Progress {
  const all = ORDER.map((id) => lineFor(id, f)).filter((l): l is Line => l !== null)
  const settled = (l: Line) => SETTLED.includes(l.state) || (l.state === 'failed' && !!LINES[l.id].optional)
  const finished = all.every(settled)
  const counted = all.filter((l) => l.state !== 'skipped')
  let sum = 0
  let total = 0
  for (const l of all) {
    const w = LINES[l.id].weight
    total += w
    if (settled(l)) sum += w
    else if (l.id === 'model' && l.state !== 'waiting') sum += w * modelShare(f)
    else if (l.id === 'voice' && f.voice) sum += w * f.voice.fraction
  }
  const percent = finished ? 100 : Math.min(99, Math.floor((sum / total) * 100))
  const running = all.find((l) => l.state === 'current')
  const stuck = all.find((l) => l.state === 'paused' || (l.state === 'failed' && !LINES[l.id].optional))
  return {
    // A part shows once it has started; the AI model from the start.
    lines: all.filter((l) => l.state !== 'waiting' || l.id === 'model'),
    featured: finished ? null : (running ?? stuck ?? null)?.id ?? null,
    ready: counted.filter((l) => l.state === 'done').length,
    total: counted.length,
    percent,
    finished,
  }
}
