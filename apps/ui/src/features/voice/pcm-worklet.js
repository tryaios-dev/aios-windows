// AudioWorklet (ADR 0016): hands the microphone's samples to the page in pieces of 2048
// (about 40 ms at 48 kHz). Runs on the audio thread; it only copies numbers.
/* global AudioWorkletProcessor, registerProcessor */
class AiosPcm extends AudioWorkletProcessor {
  constructor() {
    super()
    this.buffer = new Float32Array(2048)
    this.filled = 0
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0]
    if (channel) {
      for (let i = 0; i < channel.length; i++) {
        this.buffer[this.filled++] = channel[i]
        if (this.filled === this.buffer.length) {
          this.port.postMessage(this.buffer.slice())
          this.filled = 0
        }
      }
    }
    return true
  }
}

registerProcessor('aios-pcm', AiosPcm)
