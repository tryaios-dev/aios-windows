import workletUrl from './pcm-worklet.js?url'

/**
 * The microphone, sound only (ADR 0016). Electron main allows the `media` permission for audio
 * and nothing else; the camera stays off. The samples stay in this page until they are sent to
 * the backend through window.aios; nothing is recorded to disk.
 */
export interface Microphone {
  stop: () => void
}

/** `onAudio` gets the samples as they come, at the microphone's own rate. */
export type OpenMicrophone = (onAudio: (samples: Float32Array, rate: number) => void) => Promise<Microphone>

/** No microphone, or it is switched off or blocked: the panel says so. */
export class NoMicrophone extends Error {
  constructor() {
    super('voice_no_microphone')
  }
}

export const openMicrophone: OpenMicrophone = async (onAudio) => {
  // Made before anything is awaited, while the click that started it still counts: an audio
  // context made later can start suspended and then hears nothing.
  const context = new AudioContext()
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    })
  } catch {
    void context.close()
    throw new NoMicrophone()
  }
  try {
    await context.audioWorklet.addModule(workletUrl)
  } catch (e) {
    stream.getTracks().forEach((t) => t.stop())
    void context.close()
    throw e
  }
  const source = context.createMediaStreamSource(stream)
  const node = new AudioWorkletNode(context, 'aios-pcm', { numberOfInputs: 1, numberOfOutputs: 1 })
  // Connected to the speakers through a silent gain, so the browser keeps it running.
  const mute = context.createGain()
  mute.gain.value = 0
  node.port.onmessage = (e: MessageEvent<Float32Array>) => onAudio(e.data, context.sampleRate)
  source.connect(node)
  node.connect(mute)
  mute.connect(context.destination)
  await context.resume()
  return {
    stop: () => {
      node.port.onmessage = null
      source.disconnect()
      node.disconnect()
      mute.disconnect()
      stream.getTracks().forEach((t) => t.stop())
      void context.close()
    },
  }
}
