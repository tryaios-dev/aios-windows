import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { errorCode, type AiosBridge } from '@aios/bridge-contract'
import { bridge } from '@/bridge'
import { notInThisBuild } from '@/bridge/live'
import { useStore } from '@/lib/store'
import { NoMicrophone, openMicrophone, type Microphone, type OpenMicrophone } from './microphone'
import { Chunker, Downsampler, loudness } from './pcm'

/**
 * Speaking instead of typing (ADR 0016).
 *
 * The microphone is heard on this computer: the sound goes through window.aios to the backend,
 * where whisper-server turns it into text phrase by phrase. Each piece of sound sent returns the
 * words so far, so they appear while the person speaks (a phrase shows up a few seconds after
 * its pause). Nothing is recorded or kept, and nothing is sent by itself: the words land in the
 * message box.
 *
 * The steps a person sees:
 *   starting   the microphone is waking: no sound arrives yet (about a second on the test VM)
 *   listening  sound is arriving and everything from here is kept (the speech engine may still
 *              be starting); words appear as they are heard; a pause at the end finishes it
 *   writing    the last words are turned into text and put into the message box
 *   no-mic     there is no microphone to listen to
 */
export type DictationPhase = 'idle' | 'starting' | 'listening' | 'writing' | 'no-mic'

export interface Dictation {
  phase: DictationPhase
  /** The words heard so far, in order. */
  words: string[]
  /** Whole seconds spent listening. */
  seconds: number
  /** The sound level right now, 0 to 1. Read every frame by the drawing; it never causes a re-render. */
  level: RefObject<number>
  start: () => void
  /** Stop listening and keep what was heard. */
  finish: () => void
  /** Stop listening and throw away what was heard. */
  cancel: () => void
}

/** What the hook talks to; tests pass stand-ins. */
export interface DictationDeps {
  voice: () => AiosBridge['voice']
  openMicrophone: OpenMicrophone
  now: () => number
  /** No sound at all this long after listening starts: the microphone is not delivering. */
  noSoundAfterMs?: number
}

const DEFAULT_DEPS: DictationDeps = { voice: () => bridge().voice, openMicrophone, now: () => performance.now() }
const NO_SOUND_AFTER_MS = 3_000

/** After words were heard, this long without speaking finishes by itself. */
export const END_PAUSE_MS = 2_500
/** Louder than this counts as speaking (loudness() scale). */
const SPEAKING = 0.08
/** Sound kept while the speech engine starts: about 15 s. */
const MAX_WAITING_CHUNKS = 60

const NOTHING_HEARD: string[] = []

interface Run {
  session: Promise<string | null>
  sessionId: string | null
  mic: Microphone | null
  downsampler: Downsampler | null
  chunker: Chunker
  queue: Uint8Array[]
  sending: Promise<void> | null
  lastLoud: number
  heard: boolean
  /** Real sound has arrived. Until then the microphone sends nothing, or exact zeros (about a
   * second on the test VM), and the panel still says it is starting. */
  live: boolean
  /** Called once, on the first real sound: the panel switches to listening. */
  goLive: (() => void) | null
  watchdog: ReturnType<typeof setTimeout> | null
  words: number
  /** No more sound is taken (Done, a pause, or Cancel). */
  ended: boolean
  /** Cancel: what was heard is thrown away. */
  cancelled: boolean
  timer: ReturnType<typeof setInterval> | null
}

function say(code: string): void {
  if (code === 'voice_not_built') {
    notInThisBuild('Voice')
    return
  }
  const toast = useStore.getState().toast
  if (code === 'voice_no_model') {
    toast({
      kind: 'caution',
      title: 'Voice needs its speech model',
      description: 'The speech model is not installed on this computer yet. Nothing was recorded. You can keep typing.',
    })
    return
  }
  toast({
    kind: 'caution',
    title: 'Voice stopped',
    description: 'AIOS could not turn your speech into text this time. Try again in a moment, or keep typing.',
  })
}

const split = (text: string): string[] => text.split(/\s+/).filter(Boolean)

/** Any sample that is not exactly zero: a working microphone always has some noise. */
function hasSound(samples: Float32Array): boolean {
  for (let i = 0; i < samples.length; i++) if (samples[i] !== 0) return true
  return false
}

export function useDictation(onText: (text: string) => void, deps: DictationDeps = DEFAULT_DEPS): Dictation {
  const [phase, setPhase] = useState<DictationPhase>('idle')
  const [words, setWords] = useState<string[]>(NOTHING_HEARD)
  const [seconds, setSeconds] = useState(0)
  const level = useRef(0)
  const run = useRef<Run | null>(null)
  const onTextNow = useRef(onText)
  const depsNow = useRef(deps)
  useEffect(() => {
    onTextNow.current = onText
    depsNow.current = deps
  })

  const stopListening = (r: Run) => {
    r.mic?.stop()
    r.mic = null
    if (r.watchdog) clearTimeout(r.watchdog)
    r.watchdog = null
    if (r.timer) clearInterval(r.timer)
    r.timer = null
    level.current = 0
  }

  const end = useCallback((r: Run) => {
    r.ended = true
    r.cancelled = true
    r.queue.length = 0
    stopListening(r)
    if (run.current === r) run.current = null
  }, [])

  const cancel = useCallback(() => {
    const r = run.current
    if (r) {
      end(r)
      void r.session.then((id) => (id ? depsNow.current.voice().cancel(id) : undefined)).catch(() => undefined)
    }
    setPhase('idle')
    setWords(NOTHING_HEARD)
    setSeconds(0)
  }, [end])

  /** Send what is waiting, one call at a time, in order. */
  const pump = useCallback(
    (r: Run): Promise<void> => {
      if (r.sending) return r.sending
      if (!r.sessionId) return Promise.resolve()
      const id = r.sessionId
      const sending = (async () => {
        // Start a moment later, so sound arriving in the same moment goes in this round.
        await null
        while (r.queue.length) {
          const pcm = r.queue.shift()!
          const heard = await depsNow.current.voice().audio(id, pcm)
          if (r.cancelled) return
          const next = split(heard.text)
          r.words = next.length
          setWords(next)
        }
      })().finally(() => {
        if (r.sending === sending) r.sending = null
      })
      r.sending = sending
      return sending
    },
    [],
  )

  const finish = useCallback(() => {
    const r = run.current
    if (!r || r.ended) return
    r.ended = true // no more sound is taken
    stopListening(r)
    setPhase('writing')
    const rest = r.chunker.flush()
    if (rest) r.queue.push(rest)
    void (async () => {
      try {
        const id = await r.session
        if (!id) return
        await pump(r) // what is still waiting goes first
        const done = await depsNow.current.voice().finish(id)
        const text = done.text.trim()
        if (text) onTextNow.current(text)
      } catch (e) {
        say(errorCode(e))
      } finally {
        if (run.current === r) run.current = null
        setPhase('idle')
        setWords(NOTHING_HEARD)
        setSeconds(0)
      }
    })()
  }, [pump])

  const onAudio = useCallback(
    (r: Run, samples: Float32Array, rate: number) => {
      if (r.ended) return
      if (!r.live) {
        // Exact zeros: the microphone is on but not delivering yet. Nothing to keep.
        if (!hasSound(samples)) return
        r.live = true
        r.goLive?.()
      }
      const now = depsNow.current.now()
      const loud = loudness(samples)
      level.current = loud
      if (loud >= SPEAKING) {
        r.lastLoud = now
        r.heard = true
      }
      r.downsampler ??= new Downsampler(rate)
      for (const chunk of r.chunker.push(r.downsampler.push(samples))) {
        if (!r.sessionId && r.queue.length >= MAX_WAITING_CHUNKS) r.queue.shift()
        r.queue.push(chunk)
      }
      void pump(r).catch((e: unknown) => {
        if (run.current !== r) return
        const code = errorCode(e)
        if (code === 'voice_too_long') finish()
        else {
          say(code)
          cancel()
        }
      })
      // A pause after speaking finishes it, even before the first words are back.
      if (r.heard && now - r.lastLoud >= END_PAUSE_MS) finish()
    },
    [pump, finish, cancel],
  )

  const start = useCallback(() => {
    if (run.current) return
    const { voice, openMicrophone: open, now } = depsNow.current
    const r: Run = {
      session: Promise.resolve(null),
      sessionId: null,
      mic: null,
      downsampler: null,
      chunker: new Chunker(),
      queue: [],
      sending: null,
      lastLoud: now(),
      heard: false,
      live: false,
      goLive: null,
      watchdog: null,
      words: 0,
      ended: false,
      cancelled: false,
      timer: null,
    }
    run.current = r
    setPhase('starting')
    setWords(NOTHING_HEARD)
    setSeconds(0)
    // The speech engine and the microphone start together; sound heard meanwhile waits.
    // "Listening" (dots, timer) only once real sound arrives: what is said from that moment is
    // kept, even while the speech engine is still starting.
    r.goLive = () => {
      if (r.ended) return
      const began = now()
      r.lastLoud = began
      r.timer = setInterval(() => setSeconds(Math.floor((depsNow.current.now() - began) / 1000)), 250)
      setPhase('listening')
    }
    r.session = voice()
      .start()
      .then((s) => s.session_id)
    void (async () => {
      try {
        r.mic = await open((samples, rate) => onAudio(r, samples, rate))
      } catch (e) {
        end(r)
        void r.session.then((id) => (id ? voice().cancel(id) : undefined)).catch(() => undefined)
        if (e instanceof NoMicrophone) setPhase('no-mic')
        else {
          say('voice_failed')
          setPhase('idle')
        }
        return
      }
      if (r.ended) {
        r.mic.stop() // cancelled while the microphone was waking
        return
      }
      // No real sound at all (blocked, switched off, or taken by something else) would leave it
      // starting forever: say so instead.
      r.watchdog = setTimeout(() => {
        if (r.live || r.ended || run.current !== r) return
        end(r)
        void r.session.then((id) => (id ? depsNow.current.voice().cancel(id) : undefined)).catch(() => undefined)
        setPhase('no-mic')
        setWords(NOTHING_HEARD)
      }, depsNow.current.noSoundAfterMs ?? NO_SOUND_AFTER_MS)
      try {
        r.sessionId = await r.session
      } catch (e) {
        if (run.current !== r) return
        end(r)
        say(errorCode(e))
        setPhase('idle')
        setWords(NOTHING_HEARD)
        setSeconds(0)
        return
      }
      if (r.cancelled) return
      void pump(r).catch(() => undefined) // what was heard while the engine started goes first
    })()
  }, [onAudio, end])

  // Leaving the screen throws away whatever was being heard.
  useEffect(
    () => () => {
      const r = run.current
      if (!r) return
      end(r)
      void r.session.then((id) => (id ? depsNow.current.voice().cancel(id) : undefined)).catch(() => undefined)
    },
    [end],
  )

  return { phase, words, seconds, level, start, finish, cancel }
}
