import { useEffect, useRef } from 'react'
import { create } from 'zustand'
import { errorCode, type AiosBridge, type VoiceRecording } from '@aios/bridge-contract'
import { bridge } from '@/bridge'
import { refreshEvents } from '@/bridge/live'
import { useStore } from '@/lib/store'
import { decodeRecording, parts, RecordingError, type Decode, browserDecode } from './decodeRecording'

/**
 * Turning a recording file into text (the Voice notes skill), on the speech engine dictation
 * uses.
 *
 * The file is decoded here, in the window, into the audio dictation sends. It goes through
 * window.aios to the backend in parts of 30 s; the backend turns it into text phrase by phrase.
 * A part is sent only while little audio is waiting there, so neither side holds much of it.
 * Nothing is kept: the text lands in the message box when the person says so, and only then is
 * Activity told that it happened (never the text).
 *
 * The job belongs to the conversation it was started in, not to the screen: leaving the
 * conversation leaves it running, and coming back shows it again. If it finishes while the person
 * is elsewhere, a notice says so. One job at a time (the backend runs one); it ends with "Put in
 * message", Discard, or closing AIOS.
 *
 *   reading   the file is being decoded
 *   working   the recording is being turned into text; Stop keeps what is written so far
 *   ready     all of it (or, after Stop, the part so far) is text: put it in, or throw it away
 */
export type RecordingPhase = 'idle' | 'reading' | 'working' | 'ready'

export interface RecordingJob {
  phase: RecordingPhase
  name: string
  /** Seconds of the recording dealt with, and its length. */
  done: number
  total: number
  text: string
  stopped: boolean
  /** A recording is being turned into text in another conversation: this one waits for it. */
  elsewhere: boolean
  /** Start with a file the person picked. */
  open: (file: File) => void
  /** Stop turning it into text; what is written so far is kept. */
  stop: () => void
  /** Put the text in: `onText` gets it. */
  take: () => void
  /** Throw it away. */
  discard: () => void
}

export interface RecordingDeps {
  voice: () => AiosBridge['voice']
  decode: Decode
  /** Activity shows the new event: the window's copy of it is loaded again. */
  recorded: () => Promise<void>
  /** How long to wait before asking again whether the backend wants more audio. */
  pollMs?: number
  /** While the text waits to be put in, how often the backend is told it is still wanted. */
  keepMs?: number
}

const DEFAULT_DEPS: RecordingDeps = { voice: () => bridge().voice, decode: browserDecode, recorded: refreshEvents }
const POLL_MS = 1_000
/** The backend drops a job nobody has asked about for 2 minutes. */
const KEEP_MS = 30_000

/** Where the recording goes: the conversation it was started in. */
export interface RecordingWhere {
  conversation_id: string
  project_id: string
}

interface Job {
  where: RecordingWhere
  phase: Exclude<RecordingPhase, 'idle'>
  name: string
  progress: VoiceRecording | null
}

interface RecordingsState {
  job: Job | null
  /** How many screens show each conversation's message box. */
  watching: Record<string, number>
}

export const useRecordings = create<RecordingsState>(() => ({ job: null, watching: {} }))

interface Run {
  id: string | null
  /** Stop or discard: send nothing more. */
  halted: boolean
  deps: RecordingDeps
  keep: ReturnType<typeof setInterval> | null
}

let current: Run | null = null

function update(r: Run, patch: Partial<Job>): void {
  if (current !== r) return
  useRecordings.setState((s) => (s.job ? { job: { ...s.job, ...patch } } : s))
}

function end(r: Run): void {
  if (r.keep) clearInterval(r.keep)
  r.keep = null
  if (current !== r) return
  current = null
  useRecordings.setState({ job: null })
}

function fail(r: Run, code: string): void {
  if (r.id) void r.deps.voice().recordingDiscard(r.id).catch(() => undefined)
  end(r)
  say(code)
}

/** The text is there: keep the job alive until it is put in, and say so if nobody is looking. */
function ready(r: Run, p: VoiceRecording): void {
  if (current !== r) return
  update(r, { progress: p, phase: 'ready' })
  const id = r.id
  if (id && !r.keep) {
    r.keep = setInterval(() => {
      void r.deps
        .voice()
        .recordingProgress(id)
        .catch(() => current === r && end(r))
    }, r.deps.keepMs ?? KEEP_MS)
  }
  const job = useRecordings.getState().job
  if (job && !useRecordings.getState().watching[job.where.conversation_id]) {
    useStore.getState().toast({
      kind: 'success',
      title: 'Your recording is text now',
      description: 'Open the conversation to put it in the message box.',
      action: { label: 'Open', href: `/projects/${job.where.project_id}/c/${job.where.conversation_id}` },
      duration: 12_000,
    })
  }
}

function start(file: File, where: RecordingWhere, deps: RecordingDeps): void {
  if (current) return
  const r: Run = { id: null, halted: false, deps, keep: null }
  current = r
  useRecordings.setState({ job: { where, phase: 'reading', name: file.name, progress: null } })
  void (async () => {
    const { voice, decode, pollMs = POLL_MS } = deps
    const wait = () => new Promise((resolve) => setTimeout(resolve, pollMs))
    try {
      const { pcm, seconds } = await decodeRecording(file, decode)
      if (r.halted) return
      let p = await voice().recordingStart(seconds, [])
      r.id = p.recording_id
      if (r.halted) return void voice().recordingDiscard(p.recording_id).catch(() => undefined)
      update(r, { progress: p, phase: 'working' })
      for (const part of parts(pcm)) {
        while (!r.halted && p.waiting_s >= p.backlog_s) {
          await wait()
          p = await voice().recordingProgress(r.id)
          if (!r.halted) update(r, { progress: p })
        }
        if (r.halted) return
        p = await voice().recordingAudio(r.id, part)
        if (!r.halted) update(r, { progress: p })
      }
      if (r.halted) return
      p = await voice().recordingEnd(r.id)
      while (!r.halted && p.state === 'working') {
        update(r, { progress: p })
        await wait()
        p = await voice().recordingProgress(r.id)
      }
      if (r.halted || current !== r) return
      if (p.state === 'failed') return fail(r, 'voice_failed')
      ready(r, p)
    } catch (e) {
      if (r.halted || current !== r) return
      fail(r, e instanceof RecordingError ? e.code : errorCode(e))
    }
  })()
}

function stop(): void {
  const r = current
  if (!r?.id || r.halted) return
  r.halted = true
  void r.deps
    .voice()
    .recordingStop(r.id)
    .then((p) => ready(r, p))
    .catch((e) => current === r && fail(r, errorCode(e)))
}

function take(onText: (text: string) => void): void {
  const r = current
  const job = useRecordings.getState().job
  if (!r?.id || !job) return
  const id = r.id
  end(r)
  void r.deps
    .voice()
    .recordingTake(id, { conversation_id: job.where.conversation_id })
    .then(({ text }) => {
      if (text.trim()) onText(text.trim())
      void r.deps.recorded().catch(() => undefined)
    })
    .catch((e) => say(errorCode(e)))
}

/** Throw the recording away, wherever it was started. */
export function discardRecording(): void {
  const r = current
  if (!r) return
  r.halted = true
  if (r.id) void r.deps.voice().recordingDiscard(r.id).catch(() => undefined)
  end(r)
}

function watch(conversationId: string, by: 1 | -1): void {
  useRecordings.setState((s) => ({ watching: { ...s.watching, [conversationId]: (s.watching[conversationId] ?? 0) + by } }))
}

export function useRecording(onText: (text: string) => void, where: RecordingWhere, deps: RecordingDeps = DEFAULT_DEPS): RecordingJob {
  const job = useRecordings((s) => s.job)
  const mine = job && job.where.conversation_id === where.conversation_id ? job : null
  const onTextRef = useRef(onText)
  onTextRef.current = onText
  const whereRef = useRef(where)
  whereRef.current = where
  const depsRef = useRef(deps)
  depsRef.current = deps

  // A notice says when it is done only if this conversation is not on screen.
  const conversationId = where.conversation_id
  useEffect(() => {
    watch(conversationId, 1)
    return () => watch(conversationId, -1)
  }, [conversationId])

  const progress = mine?.progress
  return {
    phase: mine?.phase ?? 'idle',
    name: mine?.name ?? '',
    done: progress?.done_s ?? 0,
    total: progress?.total_s ?? 0,
    text: progress?.text ?? '',
    stopped: progress?.state === 'stopped',
    elsewhere: !!job && !mine,
    open: (file) => start(file, whereRef.current, depsRef.current),
    stop: () => mine && stop(),
    take: () => mine && take((text) => onTextRef.current(text)),
    discard: () => mine && discardRecording(),
  }
}

const MESSAGES: Record<string, { title: string; description: string }> = {
  voice_recording_unreadable: {
    title: 'AIOS can’t read that recording',
    description: 'Try an MP3, M4A, WAV or OGG file. Nothing was changed.',
  },
  voice_recording_too_big: { title: 'That recording is too big', description: 'Files up to 500 MB can be turned into text.' },
  voice_recording_too_long: { title: 'That recording is too long', description: 'Recordings up to two hours can be turned into text. Try a shorter part.' },
  voice_recording_silent: { title: 'That recording has no sound', description: 'There was nothing to turn into text.' },
  skill_not_enabled: { title: 'Voice notes is off', description: 'Turn it on in Add skills to my AI.' },
  voice_no_model: { title: 'Voice notes needs its speech model', description: 'Download it in Settings, Voice.' },
  voice_not_built: { title: 'Voice notes is not in this build', description: 'It comes in a later version of AIOS.' },
}

function say(code: string): void {
  const known = MESSAGES[code] ?? {
    title: 'The recording could not be turned into text',
    description: 'Try again in a moment. Nothing was put in the message box.',
  }
  useStore.getState().toast({ kind: 'caution', ...known })
}
