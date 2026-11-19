/**
 * Microphone audio as the backend wants it (ADR 0016): 16 kHz, mono, 16-bit little-endian PCM,
 * sent about every 250 ms. The microphone runs at the computer's own rate (often 48 kHz), so it
 * is brought down to 16 kHz here. Plain functions: no audio device needed to test them.
 */

export const RATE = 16_000
/** About 250 ms per call to the backend. */
export const CHUNK_SAMPLES = 4_000

/**
 * From the microphone's rate down to 16 kHz: each output sample is the average of the input
 * samples it covers (enough filtering for speech). Keeps its place between calls.
 */
export class Downsampler {
  private readonly step: number
  private sum = 0
  private count = 0
  private covered = 0

  constructor(inputRate: number) {
    if (!(inputRate >= RATE)) throw new Error('voice_rate_unsupported')
    this.step = inputRate / RATE
  }

  push(input: Float32Array): Int16Array {
    const out = new Int16Array(Math.ceil(input.length / this.step) + 1)
    let n = 0
    for (let i = 0; i < input.length; i++) {
      this.sum += input[i]
      this.count += 1
      this.covered += 1
      if (this.covered >= this.step) {
        out[n++] = toInt16(this.sum / this.count)
        this.covered -= this.step
        this.sum = 0
        this.count = 0
      }
    }
    return out.subarray(0, n)
  }
}

function toInt16(v: number): number {
  const clamped = Math.max(-1, Math.min(1, v))
  return Math.round(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff)
}

/** How loud, 0 to 1, for the drawing and to notice the end of speaking. */
export function loudness(input: Float32Array): number {
  if (input.length === 0) return 0
  let squares = 0
  for (let i = 0; i < input.length; i++) squares += input[i] * input[i]
  return Math.min(1, Math.sqrt(squares / input.length) * 6)
}

/** Collects 16 kHz samples into ~250 ms pieces of little-endian bytes. */
export class Chunker {
  private buffer = new Int16Array(CHUNK_SAMPLES)
  private filled = 0

  push(samples: Int16Array): Uint8Array[] {
    const out: Uint8Array[] = []
    let i = 0
    while (i < samples.length) {
      const take = Math.min(samples.length - i, CHUNK_SAMPLES - this.filled)
      this.buffer.set(samples.subarray(i, i + take), this.filled)
      this.filled += take
      i += take
      if (this.filled === CHUNK_SAMPLES) out.push(this.take())
    }
    return out
  }

  /** What is left (Done was pressed), or null. */
  flush(): Uint8Array | null {
    return this.filled > 0 ? this.take() : null
  }

  private take(): Uint8Array {
    const bytes = new Uint8Array(this.filled * 2)
    const view = new DataView(bytes.buffer)
    for (let i = 0; i < this.filled; i++) view.setInt16(i * 2, this.buffer[i], true)
    this.filled = 0
    return bytes
  }
}
