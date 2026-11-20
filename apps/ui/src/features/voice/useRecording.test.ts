import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AiosBridge, VoiceRecording } from '@aios/bridge-contract'
import { useStore } from '@/lib/store'
import { decodeRecording, parts, RATE, toMono16, type Decode } from './decodeRecording'
import { useRecording, type RecordingDeps } from './useRecording'

const ID = 'ab'.repeat(16)
const TARGET = { conversation_id: 'conv-1' }

/** An AudioBuffer as a 16 kHz Web Audio context gives it back. */
function buffer(seconds: number, channels = 2, value = 0.25): AudioBuffer {
  const length = Math.round(seconds * RATE)
  const data = Array.from({ length: channels }, (_, c) => new Float32Array(length).fill(c === 0 ? value : -value / 2))
  return { length, numberOfChannels: channels, sampleRate: RATE, duration: length / RATE, getChannelData: (c: number) => data[c] } as unknown as AudioBuffer
}

/** A picked file. jsdom's File has no arrayBuffer(); Chromium's does. */
const file = (name = 'call.m4a', size = 1000) =>
  Object.assign(new File([new Uint8Array(size)], name, { type: 'audio/mp4' }), { arrayBuffer: async () => new ArrayBuffer(size) })

/** The backend: turns audio into one word per 10 s, with a backlog it reports. */
function fakeBackend({ backlog = 60, slow = false } = {}) {
  const job: VoiceRecording = { recording_id: ID, state: 'working', total_s: 0, done_s: 0, waiting_s: 0, backlog_s: backlog, text: '' }
  let received = 0
  const progress = () => ({ ...job, done_s: Math.min(job.total_s, job.done_s), text: Array.from({ length: Math.floor(job.done_s / 10) }, (_, i) => `w${i}`).join(' ') })
  const voice = {
    recordingStart: vi.fn(async (seconds: number) => {
      job.total_s = seconds
      return progress()
    }),
    recordingAudio: vi.fn(async (_id: string, pcm: Uint8Array) => {
      received += pcm.byteLength / (RATE * 2)
      if (slow) job.waiting_s = received - job.done_s
      else job.done_s = received
      return progress()
    }),
    recordingEnd: vi.fn(async () => {
      if (!slow) job.state = 'done'
      return progress()
    }),
    recordingProgress: vi.fn(async () => {
      if (slow) {
        // The engine catches up a little each time it is asked.
        job.done_s = Math.min(received, job.done_s + 30)
        job.waiting_s = received - job.done_s
      }
      return progress()
    }),
    recordingStop: vi.fn(async () => {
      job.state = 'stopped'
      return progress()
    }),
    recordingTake: vi.fn(async () => ({ text: progress().text })),
    recordingDiscard: vi.fn(async () => undefined),
  }
  return { voice: voice as unknown as AiosBridge['voice'], calls: voice, job, received: () => received }
}

function setup(decoded: AudioBuffer, backend = fakeBackend()) {
  const decode: Decode = vi.fn(async () => decoded)
  const deps: RecordingDeps = { voice: () => backend.voice, decode, recorded: vi.fn(async () => undefined), pollMs: 1 }
  const onText = vi.fn()
  const hook = renderHook(() => useRecording(onText, TARGET, deps))
  return { hook, backend, onText, decode, deps }
}

afterEach(() => {
  vi.restoreAllMocks()
  useStore.setState({ toasts: [] })
})

describe('a recording into text (the Voice notes skill)', () => {
  it('decodes the file to 16 kHz mono, sends it in 30 s parts, and the text goes in when asked', async () => {
    const { hook, backend, onText, deps } = setup(buffer(95))
    act(() => hook.result.current.open(file()))
    expect(hook.result.current.phase).toBe('reading')
    await waitFor(() => expect(hook.result.current.phase).toBe('ready'))

    expect(backend.calls.recordingStart).toHaveBeenCalledWith(95, []) // the languages come from Settings > Voice, as for dictation
    const sizes = backend.calls.recordingAudio.mock.calls.map(([, pcm]) => pcm.byteLength)
    expect(sizes).toEqual([960_000, 960_000, 960_000, 160_000]) // 30 + 30 + 30 + 5 s, 16-bit
    expect(backend.calls.recordingEnd).toHaveBeenCalledOnce()
    expect(hook.result.current.done).toBe(95)
    expect(onText).not.toHaveBeenCalled() // nothing goes in by itself

    act(() => hook.result.current.take())
    await waitFor(() => expect(onText).toHaveBeenCalledWith('w0 w1 w2 w3 w4 w5 w6 w7 w8'))
    expect(backend.calls.recordingTake).toHaveBeenCalledWith(ID, TARGET)
    expect(deps.recorded).toHaveBeenCalledOnce() // Activity loads the new event
    expect(hook.result.current.phase).toBe('idle')
  })

  it('waits while the backend has a backlog instead of sending the whole recording at once', async () => {
    const backend = fakeBackend({ backlog: 60, slow: true })
    const { hook } = setup(buffer(150), backend)
    act(() => hook.result.current.open(file()))
    await waitFor(() => expect(backend.calls.recordingEnd).toHaveBeenCalled())
    // Every part was sent only once the waiting audio was under 60 s.
    expect(backend.calls.recordingProgress).toHaveBeenCalled()
    expect(backend.received()).toBe(150)
  })

  it('Stop keeps the text so far and sends nothing more', async () => {
    const backend = fakeBackend({ slow: true, backlog: 1 })
    const { hook, onText } = setup(buffer(600), backend)
    act(() => hook.result.current.open(file()))
    await waitFor(() => expect(hook.result.current.phase).toBe('working'))
    await waitFor(() => expect(backend.calls.recordingAudio).toHaveBeenCalled())
    act(() => hook.result.current.stop())
    await waitFor(() => expect(hook.result.current.phase).toBe('ready'))
    expect(hook.result.current.stopped).toBe(true)
    const sent = backend.calls.recordingAudio.mock.calls.length
    await new Promise((r) => setTimeout(r, 20))
    expect(backend.calls.recordingAudio.mock.calls.length).toBe(sent)
    expect(backend.received()).toBeLessThan(600)
    act(() => hook.result.current.take())
    await waitFor(() => expect(backend.calls.recordingTake).toHaveBeenCalled())
    expect(onText.mock.calls.length).toBeLessThanOrEqual(1)
  })

  it('Discard throws it away and tells the backend', async () => {
    const { hook, backend, onText, deps } = setup(buffer(40))
    act(() => hook.result.current.open(file()))
    await waitFor(() => expect(hook.result.current.phase).toBe('ready'))
    act(() => hook.result.current.discard())
    expect(hook.result.current.phase).toBe('idle')
    await waitFor(() => expect(backend.calls.recordingDiscard).toHaveBeenCalledWith(ID))
    expect(backend.calls.recordingTake).not.toHaveBeenCalled()
    expect(onText).not.toHaveBeenCalled()
    expect(deps.recorded).not.toHaveBeenCalled()
  })

  it('leaving the screen throws it away', async () => {
    const { hook, backend } = setup(buffer(40))
    act(() => hook.result.current.open(file()))
    await waitFor(() => expect(hook.result.current.phase).toBe('ready'))
    hook.unmount()
    await waitFor(() => expect(backend.calls.recordingDiscard).toHaveBeenCalledWith(ID))
  })

  it.each([
    ['a file it cannot read', async () => Promise.reject(new Error('EncodingError')), 'AIOS can’t read that recording'],
    ['a recording over two hours', async () => buffer(7201, 1, 0), 'That recording is too long'],
  ])('%s: says so in plain words and sends nothing', async (_name, decodeImpl, title) => {
    const backend = fakeBackend()
    const deps: RecordingDeps = { voice: () => backend.voice, decode: decodeImpl as Decode, recorded: vi.fn(async () => undefined), pollMs: 1 }
    const hook = renderHook(() => useRecording(vi.fn(), TARGET, deps))
    act(() => hook.result.current.open(file()))
    await waitFor(() => expect(hook.result.current.phase).toBe('idle'))
    expect(useStore.getState().toasts.map((t) => t.title)).toContain(title)
    expect(backend.calls.recordingStart).not.toHaveBeenCalled()
  })

  it('Voice notes turned off: says how to turn it on', async () => {
    const backend = fakeBackend()
    backend.calls.recordingStart.mockRejectedValueOnce(new Error('skill_not_enabled'))
    const { hook } = setup(buffer(10), backend)
    act(() => hook.result.current.open(file()))
    await waitFor(() => expect(hook.result.current.phase).toBe('idle'))
    expect(useStore.getState().toasts.map((t) => t.title)).toContain('Voice notes is off')
  })
})

describe('decoding', () => {
  it('averages the channels into 16-bit samples', () => {
    const pcm = toMono16(buffer(0.01, 2, 0.5)) // left 0.5, right -0.25: average 0.125
    expect(pcm.length).toBe(160)
    expect(pcm[0]).toBe(Math.round(0.125 * 0x7fff))
  })

  it('refuses a file over 500 MB before reading it', async () => {
    const decode = vi.fn()
    const huge = { size: 501 * 1024 * 1024, arrayBuffer: vi.fn() } as unknown as Blob
    await expect(decodeRecording(huge, decode)).rejects.toThrow('voice_recording_too_big')
    expect(decode).not.toHaveBeenCalled()
  })

  it('cuts the audio into copies, not views of the whole recording', () => {
    const all = [...parts(new Int16Array(RATE * 70))]
    expect(all.map((p) => p.byteLength)).toEqual([960_000, 960_000, 320_000])
    expect(all.every((p) => p.buffer.byteLength === p.byteLength)).toBe(true)
  })
})
