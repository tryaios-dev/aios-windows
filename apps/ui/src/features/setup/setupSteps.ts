import type { VignetteKind } from '@/components/app/Vignettes'
import type { RunStep, RunStepId } from './setupRun'

/**
 * The lines of Setting up, worked out from what the backend reports and nothing else (test
 * findings 4 and 5). Every line is there from the start; the title names a line that is running;
 * the counter counts the ticked lines; the percentage covers every line and reads 100 only when
 * all of them are settled.
 *
 * Names and order are placeholders until the design's eight steps arrive (finding 4): change
 * them in LINES only.
 */
export type LineId = 'storage' | 'rules' | 'activity' | 'voice' | 'download' | 'check' | 'engine' | 'project'
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
  storage: { name: 'Encrypted storage', adding: 'Creating your encrypted storage', ready: 'Your storage is encrypted', detail: 'Only this computer can open it', why: 'Everything AIOS keeps is encrypted on this computer. Your recovery key comes next.', drawing: 'storage', weight: 2 },
  rules: { name: 'Rules', adding: 'Turning on the rules', ready: 'Rules are on', detail: 'Nothing leaves this computer unless you say so', why: 'Built-in rules decide what your AI may do. The first: nothing leaves this computer unless you say so.', drawing: 'rules', weight: 1 },
  activity: { name: 'Activity log', adding: 'Starting the activity log', ready: 'Activity log is on', detail: 'You can see everything your AI does', why: 'Every action is written down in plain words, in order, so you can always see what your AI did.', drawing: 'activity', weight: 1 },
  voice: { name: 'Voice', adding: 'Downloading speech for Voice', ready: 'Voice is ready', detail: 'Speak instead of typing, turned into text on this computer', why: 'Speak instead of typing. Your voice is turned into text on this computer.', drawing: 'voice', weight: 3, optional: true },
  download: { name: 'AI model', adding: 'Downloading your AI model', ready: 'Your AI model is downloaded', detail: '', why: 'The AI itself. It runs on this computer and keeps working with no internet.', drawing: 'model', weight: 20 },
  check: { name: 'Checking the AI model', adding: 'Checking your AI model', ready: 'Your AI model is checked', detail: 'It is the genuine, unmodified file', why: 'AIOS makes sure the file is exactly the one that passed its checks.', drawing: 'model', weight: 2 },
  engine: { name: 'AI engine', adding: 'Starting the AI engine', ready: 'The AI engine is running', detail: 'Chat works straight away', why: 'The engine runs your AI model on this computer, so chat is ready when you are.', drawing: 'model', weight: 3, optional: true },
  project: { name: 'First project', adding: 'Opening your first project', ready: 'Your first project is ready', detail: 'Restricted: it stays on this computer', why: 'Projects keep conversations and documents together. Your first one is ready to use.', drawing: 'knowledge', weight: 1 },
}

export const ORDER: LineId[] = ['storage', 'rules', 'activity', 'voice', 'download', 'check', 'engine', 'project']

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
  switch (id) {
    case 'storage':
    case 'rules':
    case 'activity':
    case 'project':
      return plain(RUN_STATE[f.run[id].state], f.run[id].state === 'failed' ? 'It did not start. Try again.' : undefined)
    case 'engine':
      if (f.model === 'skipped') return { id, state: 'skipped', title: 'No AI engine for now', detail: 'It starts once you add an AI model' }
      if (f.run.engine.state === 'failed') return { id, state: 'failed', title: 'The AI engine did not start yet', detail: 'It starts by itself when you send a message' }
      return plain(RUN_STATE[f.run.engine.state])
    case 'voice': {
      const v = f.voice
      if (!v) return null
      if (v.state === 'ready') return plain('done')
      if (v.state === 'failed') return { id, state: 'failed', title: 'Voice was not downloaded', detail: 'You can add it later in Settings, Voice' }
      if (v.state === 'checking') return { id, state: 'current', title: 'Checking the speech model', detail: 'Making sure it is the genuine, unmodified file' }
      return { id, state: v.state === 'waiting' ? 'waiting' : 'current', title: text.adding, detail: v.detail, live: v.state === 'downloading' }
    }
    case 'download': {
      const m = f.model
      if (m === 'skipped') return { id, state: 'skipped', title: 'No AI model for now', detail: 'You can add one later from AI models' }
      if (m === 'ready' || m === 'checking') return { id, state: 'done', title: text.ready, detail: f.modelDetail }
      if (m === 'copying') return { id, state: 'current', title: 'Copying your AI model', detail: f.modelDetail }
      if (m === 'paused') return { id, state: 'paused', title: 'Download paused', detail: f.modelDetail }
      if (m === 'dropped') return { id, state: 'failed', title: 'The connection dropped', detail: f.modelDetail }
      if (m === 'no-space') return { id, state: 'failed', title: 'Not enough free space for the AI model', detail: f.modelDetail }
      if (m === 'damaged') return { id, state: 'done', title: text.ready, detail: f.modelDetail }
      return { id, state: 'current', title: text.adding, detail: f.modelDetail, live: true }
    }
    case 'check': {
      const m = f.model
      if (m === 'skipped') return { id, state: 'skipped', title: 'Nothing to check', detail: 'No AI model for now' }
      if (m === 'ready') return plain('done')
      if (m === 'checking') return { id, state: 'current', title: text.adding, detail: 'Making sure it is the genuine, unmodified file' }
      if (m === 'damaged') return { id, state: 'failed', title: 'The AI model did not pass its check', detail: 'AIOS removed it. Nothing from it was kept' }
      return plain('waiting')
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

export function progress(f: Facts): Progress {
  const lines = ORDER.map((id) => lineFor(id, f)).filter((l): l is Line => l !== null)
  const settled = (l: Line) => SETTLED.includes(l.state) || (l.state === 'failed' && !!LINES[l.id].optional)
  const finished = lines.every(settled)
  const counted = lines.filter((l) => l.state !== 'skipped')
  let sum = 0
  let total = 0
  for (const l of lines) {
    const w = LINES[l.id].weight
    total += w
    if (settled(l)) sum += w
    else if (l.id === 'download' && l.state !== 'waiting') sum += w * f.modelFraction
    else if (l.id === 'voice' && f.voice) sum += w * f.voice.fraction
  }
  const percent = finished ? 100 : Math.min(99, Math.floor((sum / total) * 100))
  const running = lines.find((l) => l.state === 'current')
  const stuck = lines.find((l) => l.state === 'paused' || (l.state === 'failed' && !LINES[l.id].optional))
  return {
    lines,
    featured: finished ? null : (running ?? stuck ?? null)?.id ?? null,
    ready: counted.filter((l) => l.state === 'done').length,
    total: counted.length,
    percent,
    finished,
  }
}
