import { useCallback, useEffect, useRef, useState } from 'react'
import { errorCode, type AiosBridge, type VoiceRecording } from '@aios/bridge-contract'
import { bridge } from '@/bridge'
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
  /** How long to wait before asking again whether the backend wants more audio. */
  pollMs?: number
}

const DEFAULT_DEPS: RecordingDeps = { voice: () => bridge().voice, decode: browserDecode }
const POLL_MS = 1_000

interface Run {
  id: string | null
  /** Stop, discard, or leaving the screen: send nothing more. */
  halted: boolean
}

export function useRecording(
  onText: (text: string) => void,
  target: { conversation_id: string },
  deps: RecordingDeps = DEFAULT_DEPS,
): RecordingJob {
  const [phase, setPhase] = useState<RecordingPhase>('idle')
  const [name, setName] = useState('')
  const [progress, setProgress] = useState<VoiceRecording | null>(null)
  const run = useRef<Run | null>(null)
  const depsRef = useRef(deps)
  depsRef.current = deps
  const onTextRef = useRef(onText)
  onTextRef.current = onText

  const reset = useCallback(() => {
    run.current = null
    setPhase('idle')
    setName('')
    setProgress(null)
  }, [])

  const fail = useCallback(
    (code: string) => {
      const r = run.current
      if (r?.id) void depsRef.current.voice().recordingDiscard(r.id).catch(() => undefined)
      say(code)
      reset()
    },
    [reset],
  )

  const open = useCallback(
    (file: File) => {
      if (run.current) return
      const r: Run = { id: null, halted: false }
      run.current = r
      setName(file.name)
      setPhase('reading')
      void (async () => {
        const { voice, decode, pollMs = POLL_MS } = depsRef.current
        const wait = () => new Promise((resolve) => setTimeout(resolve, pollMs))
        try {
          const { pcm, seconds } = await decodeRecording(file, decode)
          if (r.halted) return
          let p = await voice().recordingStart(seconds, [...navigator.languages])
          r.id = p.recording_id
          if (r.halted) return void voice().recordingDiscard(p.recording_id).catch(() => undefined)
          setProgress(p)
          setPhase('working')
          for (const part of parts(pcm)) {
            while (!r.halted && p.waiting_s >= p.backlog_s) {
              await wait()
              p = await voice().recordingProgress(r.id)
              if (!r.halted) setProgress(p)
            }
            if (r.halted) return
            p = await voice().recordingAudio(r.id, part)
            if (!r.halted) setProgress(p)
          }
          if (r.halted) return
          p = await voice().recordingEnd(r.id)
          while (!r.halted && p.state === 'working') {
            setProgress(p)
            await wait()
            p = await voice().recordingProgress(r.id)
          }
          if (r.halted || run.current !== r) return
          if (p.state === 'failed') return fail('voice_failed')
          setProgress(p)
          setPhase('ready')
        } catch (e) {
          if (r.halted || run.current !== r) return
          fail(e instanceof RecordingError ? e.code : errorCode(e))
        }
      })()
    },
    [fail],
  )

  const stop = useCallback(() => {
    const r = run.current
    if (!r?.id || r.halted) return
    r.halted = true
    void depsRef.current
      .voice()
      .recordingStop(r.id)
      .then((p) => {
        if (run.current !== r) return
        setProgress(p)
        setPhase('ready')
      })
      .catch((e) => run.current === r && fail(errorCode(e)))
  }, [fail])

  const take = useCallback(() => {
    const r = run.current
    if (!r?.id) return
    const id = r.id
    reset()
    void depsRef.current
      .voice()
      .recordingTake(id, target)
      .then(({ text }) => {
        if (text.trim()) onTextRef.current(text.trim())
      })
      .catch((e) => say(errorCode(e)))
  }, [reset, target])

  const discard = useCallback(() => {
    const r = run.current
    if (!r) return
    r.halted = true
    if (r.id) void depsRef.current.voice().recordingDiscard(r.id).catch(() => undefined)
    reset()
  }, [reset])

  // Leaving the screen throws it away.
  useEffect(
    () => () => {
      const r = run.current
      if (!r) return
      r.halted = true
      if (r.id) void depsRef.current.voice().recordingDiscard(r.id).catch(() => undefined)
    },
    [],
  )

  return {
    phase,
    name,
    done: progress?.done_s ?? 0,
    total: progress?.total_s ?? 0,
    text: progress?.text ?? '',
    stopped: progress?.state === 'stopped',
    open,
    stop,
    take,
    discard,
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
