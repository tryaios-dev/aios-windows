/**
 * A recording file (MP3, M4A, WAV, OGG, …) turned into the audio dictation sends: 16 kHz, mono,
 * 16-bit. The browser's own audio decoding does it (Web Audio, `decodeAudioData`), so no ffmpeg
 * and no new dependency. Everything stays in this window's memory; nothing is written anywhere.
 */
import { VOICE_MAX_RECORDING_S } from '@aios/bridge-contract'

export const RATE = 16_000
/** A larger file is refused before it is read: decoding it would use too much memory. */
export const MAX_FILE_BYTES = 500 * 1024 * 1024
/**
 * Shown in the file picker; anything else the browser can decode works too. Windows files some
 * audio under video types, so those extensions are listed: WhatsApp saves voice notes as .mpeg
 * (MP3 inside), phones record .mp4 and .3gp.
 */
export const ACCEPT = 'audio/*,.mp3,.mpeg,.mpga,.m4a,.mp4,.3gp,.3gpp,.aac,.wav,.ogg,.oga,.opus,.flac,.webm,.wma'

export class RecordingError extends Error {
  constructor(readonly code: 'voice_recording_unreadable' | 'voice_recording_too_big' | 'voice_recording_too_long' | 'voice_recording_silent') {
    super(code)
  }
}

export interface DecodedRecording {
  /** 16 kHz mono samples. */
  pcm: Int16Array
  seconds: number
}

/** The audio decoder: a Web Audio context running at 16 kHz resamples as it decodes. */
export type Decode = (data: ArrayBuffer) => Promise<AudioBuffer>

export const browserDecode: Decode = (data) => new OfflineAudioContext(1, 1, RATE).decodeAudioData(data)

export async function decodeRecording(file: Blob, decode: Decode = browserDecode): Promise<DecodedRecording> {
  if (file.size > MAX_FILE_BYTES) throw new RecordingError('voice_recording_too_big')
  let audio: AudioBuffer
  try {
    audio = await decode(await file.arrayBuffer())
  } catch {
    throw new RecordingError('voice_recording_unreadable')
  }
  if (audio.duration > VOICE_MAX_RECORDING_S) throw new RecordingError('voice_recording_too_long')
  const pcm = toMono16(audio)
  if (pcm.length === 0) throw new RecordingError('voice_recording_silent')
  return { pcm, seconds: pcm.length / RATE }
}

/** Average the channels and convert to 16-bit, as the microphone path does. */
export function toMono16(audio: Pick<AudioBuffer, 'length' | 'numberOfChannels' | 'sampleRate' | 'getChannelData'>): Int16Array {
  if (audio.sampleRate !== RATE) throw new RecordingError('voice_recording_unreadable')
  const channels = Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i))
  const out = new Int16Array(audio.length)
  for (let i = 0; i < audio.length; i++) {
    let sum = 0
    for (const channel of channels) sum += channel[i]
    const v = Math.max(-1, Math.min(1, sum / channels.length))
    out[i] = Math.round(v < 0 ? v * 0x8000 : v * 0x7fff)
  }
  return out
}

/** The recording in parts of `seconds`, each a copy (a view would send the whole buffer). */
export function* parts(pcm: Int16Array, seconds = 30): Generator<Uint8Array> {
  const step = RATE * seconds
  for (let i = 0; i < pcm.length; i += step) yield new Uint8Array(pcm.slice(i, i + step).buffer)
}
