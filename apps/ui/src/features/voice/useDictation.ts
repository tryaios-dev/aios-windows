import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { useStore } from '@/lib/store'

/**
 * Speaking instead of typing.
 *
 * In the product, the microphone is heard by the voice part of AIOS, which
 * runs on this computer and turns speech into text as it arrives. In this
 * prototype there is no microphone: a sentence is "heard" word by word at a
 * speaking pace, with a sound level that rises while a word is spoken and
 * falls in the gaps, so the screen behaves as it will with a real voice.
 *
 * The steps a person sees:
 *   starting   the microphone is waking (well under a second)
 *   listening  words appear as they are heard; a pause at the end finishes it
 *   writing    the words are tidied and put into the message box
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

/** What the prototype "hears". Each use takes the next one, so trying it twice does not repeat. */
const HEARD = [
  'Summarise the main points of the Harbourline lease, and list anything I need to decide before Friday.',
  'Draft a short, friendly reply to Marta saying the report will be with her on Thursday morning.',
  'What are the three biggest risks in the launch plan, and what would you do about each one?',
  'Turn my notes from this morning into minutes, with a list of who is doing what and by when.',
]
let turn = 0

/** How long a word takes to say, and the breath after a comma or a full stop. */
function paceOf(word: string): { say: number; gap: number } {
  const say = 150 + Math.min(word.length, 12) * 34
  const gap = /[.?!]$/.test(word) ? 420 : /[,;:]$/.test(word) ? 260 : 70
  return { say, gap }
}

export function useDictation(onText: (text: string) => void): Dictation {
  const [phase, setPhase] = useState<DictationPhase>('idle')
  const [words, setWords] = useState<string[]>([])
  const [seconds, setSeconds] = useState(0)
  const level = useRef(0)
  const timers = useRef<number[]>([])
  const ticker = useRef<number | null>(null)
  const speakingUntil = useRef(0)
  const heard = useRef<string[]>([])
  const deliver = useRef(onText)
  useEffect(() => {
    deliver.current = onText
  }, [onText])

  const clear = useCallback(() => {
    timers.current.forEach((t) => window.clearTimeout(t))
    timers.current = []
    if (ticker.current !== null) window.clearInterval(ticker.current)
    ticker.current = null
    level.current = 0
  }, [])

  const later = (fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms))
  }

  const reset = useCallback(() => {
    clear()
    heard.current = []
    setWords([])
    setSeconds(0)
    setPhase('idle')
  }, [clear])

  const finish = useCallback(() => {
    clear()
    const text = heard.current.join(' ')
    if (!text) {
      reset()
      return
    }
    setPhase('writing')
    later(() => {
      reset()
      deliver.current(text)
    }, 560)
  }, [clear, reset])

  const start = useCallback(() => {
    clear()
    heard.current = []
    setWords([])
    setSeconds(0)
    if (useStore.getState().sim.micUnavailable) {
      setPhase('no-mic')
      return
    }
    setPhase('starting')
    const sentence = HEARD[turn % HEARD.length].split(' ')
    turn += 1

    later(() => {
      setPhase('listening')
      const began = performance.now()
      // The sound level follows the voice: up while a word is being said, down in the gaps.
      ticker.current = window.setInterval(() => {
        const now = performance.now()
        const target = now < speakingUntil.current ? 0.38 + Math.random() * 0.62 : 0.03 + Math.random() * 0.05
        level.current += (target - level.current) * 0.5
        setSeconds(Math.floor((now - began) / 1000))
      }, 60)

      let at = 650
      sentence.forEach((word) => {
        const { say, gap } = paceOf(word)
        const startsAt = at
        later(() => {
          speakingUntil.current = performance.now() + say
        }, startsAt)
        // A word is written a moment after it has been said, as it is with real speech-to-text.
        later(() => {
          heard.current = [...heard.current, word]
          setWords(heard.current)
        }, startsAt + say * 0.8)
        at += say + gap
      })
      // A pause after the last word ends it, so there is nothing to press.
      later(finish, at + 1500)
    }, 420)
  }, [clear, finish])

  useEffect(() => clear, [clear])

  return { phase, words, seconds, level, start, finish, cancel: reset }
}
