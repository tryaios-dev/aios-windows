import { useCallback, useRef, type RefObject } from 'react'
import { notInThisBuild } from '@/bridge/live'

/**
 * Speaking instead of typing.
 *
 * In the product, the microphone is heard by the voice part of AIOS, which runs on this computer and
 * turns speech into text as it arrives. The backend has no speech to text yet, so nothing is ever
 * "heard": starting says so and the panel stays closed. The shape below is what the voice part will
 * drive, so the panel needs no change when it arrives.
 *
 * The steps a person will see:
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

const NOTHING_HEARD: string[] = []

export function useDictation(_onText: (text: string) => void): Dictation {
  const level = useRef(0)
  const start = useCallback(() => notInThisBuild('Voice'), [])
  const idle = useCallback(() => undefined, [])
  return { phase: 'idle', words: NOTHING_HEARD, seconds: 0, level, start, finish: idle, cancel: idle }
}
