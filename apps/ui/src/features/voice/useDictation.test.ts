import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AiosBridge } from '@aios/bridge-contract'
import { useStore } from '@/lib/store'
import { NoMicrophone, type OpenMicrophone } from './microphone'
import { END_PAUSE_MS, useDictation, type DictationDeps } from './useDictation'

const RATE = 48_000
const SESSION = '0123456789abcdef0123456789abcdef'

/** A microphone the test speaks into. */
function fakeMic() {
  let listener: ((s: Float32Array, rate: number) => void) | null = null
  const stop = vi.fn()
  const open: OpenMicrophone = async (onAudio) => {
    listener = onAudio
    return { stop }
  }
  const speak = (seconds: number, amplitude = 0.4) => {
    const n = Math.round(RATE * seconds)
    for (let i = 0; i < n; i += 2048) {
      const piece = Float32Array.from({ length: Math.min(2048, n - i) }, (_, j) => amplitude * Math.sin((i + j) / 10))
      listener?.(piece, RATE)
    }
  }
  return { open, stop, speak, opened: () => listener !== null }
}

/** The backend: each audio call adds a word once some sound has arrived. */
function fakeVoice(text = ['Hello', 'there']) {
  let bytes = 0
  const voice = {
    status: vi.fn(),
    downloadModel: vi.fn(),
    start: vi.fn(async () => ({ session_id: SESSION })),
    audio: vi.fn(async (_id: string, pcm: Uint8Array) => {
      bytes += pcm.byteLength
      const n = Math.min(text.length, Math.floor(bytes / 16_000)) // one word per 0.5 s of sound
      return { text: text.slice(0, n).join(' '), pending: false }
    }),
    finish: vi.fn(async () => ({ text: ` ${text.join(' ')} ` })),
    cancel: vi.fn(async () => undefined),
  } satisfies AiosBridge['voice']
  return { voice, sent: () => bytes }
}

function setup(over: Partial<DictationDeps> = {}) {
  const mic = fakeMic()
  const backend = fakeVoice()
  let clock = 0
  const deps: DictationDeps = { voice: () => backend.voice, openMicrophone: mic.open, now: () => clock, ...over }
  const onText = vi.fn()
  const hook = renderHook(() => useDictation(onText, deps))
  return { hook, mic, backend, onText, tick: (ms: number) => (clock += ms) }
}

afterEach(() => {
  vi.restoreAllMocks()
  useStore.setState({ toasts: [] })
})

describe('speaking instead of typing (ADR 0016)', () => {
  it('words appear while speaking, and Done puts the text in the message box', async () => {
    const { hook, mic, backend, onText } = setup()
    act(() => hook.result.current.start())
    expect(hook.result.current.phase).toBe('starting')
    await waitFor(() => expect(hook.result.current.phase).toBe('listening'))

    act(() => mic.speak(1.2))
    await waitFor(() => expect(hook.result.current.words).toEqual(['Hello', 'there']))
    // 16 kHz, 16-bit: 1.2 s of sound is about 38 400 bytes, sent in ~250 ms pieces.
    expect(backend.voice.audio.mock.calls.every(([, pcm]) => pcm.byteLength === 8_000)).toBe(true)

    act(() => hook.result.current.finish())
    expect(hook.result.current.phase).toBe('writing')
    await waitFor(() => expect(hook.result.current.phase).toBe('idle'))
    expect(onText).toHaveBeenCalledWith('Hello there')
    expect(mic.stop).toHaveBeenCalled()
    expect(backend.voice.finish).toHaveBeenCalledWith(SESSION)
    expect(backend.sent()).toBeGreaterThanOrEqual(38_000) // the last piece went too
    expect(backend.voice.cancel).not.toHaveBeenCalled()
  })

  it('a pause after the words finishes by itself', async () => {
    const { hook, mic, onText, tick } = setup()
    act(() => hook.result.current.start())
    await waitFor(() => expect(hook.result.current.phase).toBe('listening'))
    act(() => mic.speak(1.2))
    await waitFor(() => expect(hook.result.current.words.length).toBe(2))
    act(() => {
      tick(END_PAUSE_MS + 100)
      mic.speak(0.1, 0.001) // quiet
    })
    await waitFor(() => expect(onText).toHaveBeenCalledWith('Hello there'))
    expect(hook.result.current.phase).toBe('idle')
  })

  it('a pause after speaking finishes even before the first words are back', async () => {
    const { hook, mic, onText, tick } = setup()
    act(() => hook.result.current.start())
    await waitFor(() => expect(hook.result.current.phase).toBe('listening'))
    act(() => mic.speak(0.3)) // too little sound for any words yet
    expect(hook.result.current.words).toEqual([])
    act(() => {
      tick(END_PAUSE_MS + 100)
      mic.speak(0.1, 0.001)
    })
    await waitFor(() => expect(hook.result.current.phase).toBe('idle'))
    expect(onText).toHaveBeenCalledWith('Hello there')
  })

  it('a microphone that delivers no sound at all says so instead of listening forever', async () => {
    const { hook, mic, backend } = setup({ noSoundAfterMs: 50 })
    act(() => hook.result.current.start())
    await waitFor(() => expect(hook.result.current.phase).toBe('listening'))
    await waitFor(() => expect(hook.result.current.phase).toBe('no-mic'))
    expect(mic.stop).toHaveBeenCalled()
    await waitFor(() => expect(backend.voice.cancel).toHaveBeenCalledWith(SESSION))
  })

  it('Cancel throws it away and tells the backend', async () => {
    const { hook, mic, backend, onText } = setup()
    act(() => hook.result.current.start())
    await waitFor(() => expect(hook.result.current.phase).toBe('listening'))
    act(() => mic.speak(0.6))
    act(() => hook.result.current.cancel())
    expect(hook.result.current.phase).toBe('idle')
    expect(hook.result.current.words).toEqual([])
    await waitFor(() => expect(backend.voice.cancel).toHaveBeenCalledWith(SESSION))
    expect(mic.stop).toHaveBeenCalled()
    expect(onText).not.toHaveBeenCalled()
    expect(backend.voice.finish).not.toHaveBeenCalled()
  })

  it('sound heard while the speech engine starts is kept', async () => {
    let ready: (v: { session_id: string }) => void = () => undefined
    const { hook, mic, backend } = setup()
    backend.voice.start.mockImplementationOnce(() => new Promise((r) => (ready = r)))
    act(() => hook.result.current.start())
    await waitFor(() => expect(mic.opened()).toBe(true))
    act(() => mic.speak(0.5))
    expect(backend.voice.audio).not.toHaveBeenCalled()
    await act(async () => ready({ session_id: SESSION }))
    await waitFor(() => expect(hook.result.current.phase).toBe('listening'))
    await waitFor(() => expect(backend.sent()).toBeGreaterThanOrEqual(15_000))
  })

  it('no microphone: the panel says so and the speech engine is let go', async () => {
    const { hook, backend } = setup({
      openMicrophone: async () => {
        throw new NoMicrophone()
      },
    })
    act(() => hook.result.current.start())
    await waitFor(() => expect(hook.result.current.phase).toBe('no-mic'))
    await waitFor(() => expect(backend.voice.cancel).toHaveBeenCalledWith(SESSION))
  })

  it.each([
    ['voice_no_model', 'Voice needs its speech model'],
    ['voice_failed', 'Voice stopped'],
    ['voice_not_built', 'Voice is not in this build yet'],
  ])('%s: says so in plain words and stops listening', async (code, title) => {
    const { hook, mic, backend } = setup()
    backend.voice.start.mockRejectedValueOnce(new Error(code))
    act(() => hook.result.current.start())
    await waitFor(() => expect(hook.result.current.phase).toBe('idle'))
    expect(useStore.getState().toasts.map((t) => t.title)).toContain(title)
    await waitFor(() => expect(mic.stop).toHaveBeenCalled())
  })

  it('leaving the screen stops the microphone and throws the words away', async () => {
    const { hook, mic, backend } = setup()
    act(() => hook.result.current.start())
    await waitFor(() => expect(hook.result.current.phase).toBe('listening'))
    hook.unmount()
    expect(mic.stop).toHaveBeenCalled()
    await waitFor(() => expect(backend.voice.cancel).toHaveBeenCalledWith(SESSION))
  })
})
