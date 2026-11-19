import { describe, expect, it } from 'vitest'
import { CHUNK_SAMPLES, Chunker, Downsampler, loudness, RATE } from './pcm'

const sine = (rate: number, seconds: number, hz = 220, amp = 0.5) =>
  Float32Array.from({ length: Math.round(rate * seconds) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / rate))

describe('microphone audio for the backend (ADR 0016)', () => {
  it.each([48_000, 44_100, 16_000])('brings %i Hz down to 16 kHz', (rate) => {
    const d = new Downsampler(rate)
    let total = 0
    // In the 128-sample pieces an audio worklet delivers.
    const input = sine(rate, 1)
    for (let i = 0; i < input.length; i += 128) total += d.push(input.subarray(i, i + 128)).length
    expect(Math.abs(total - RATE)).toBeLessThanOrEqual(1)
  })

  it('keeps the sound: a 220 Hz tone stays a loud tone', () => {
    const out = new Downsampler(48_000).push(sine(48_000, 0.1))
    const peak = Math.max(...Array.from(out, Math.abs))
    expect(peak).toBeGreaterThan(0.45 * 0x7fff)
    expect(peak).toBeLessThanOrEqual(0x7fff)
  })

  it('clips instead of wrapping around', () => {
    const out = new Downsampler(16_000).push(Float32Array.from([2, -2, 1, -1]))
    expect(Array.from(out)).toEqual([0x7fff, -0x8000, 0x7fff, -0x8000])
  })

  it('refuses a rate below 16 kHz', () => {
    expect(() => new Downsampler(8_000)).toThrow()
  })

  it('sends ~250 ms pieces of little-endian bytes', () => {
    const c = new Chunker()
    expect(c.push(new Int16Array(CHUNK_SAMPLES - 1))).toEqual([])
    const [piece] = c.push(Int16Array.from([1, 0x0203]))
    expect(piece.byteLength).toBe(CHUNK_SAMPLES * 2)
    expect(Array.from(piece.subarray(-2))).toEqual([1, 0]) // sample "1", low byte first
    const rest = c.flush()
    expect(Array.from(rest ?? [])).toEqual([0x03, 0x02])
    expect(c.flush()).toBeNull()
  })

  it('measures loudness from 0 to 1', () => {
    expect(loudness(new Float32Array(128))).toBe(0)
    expect(loudness(sine(48_000, 0.01, 220, 1))).toBe(1)
    expect(loudness(sine(48_000, 0.01, 220, 0.02))).toBeLessThan(0.2)
  })
})
