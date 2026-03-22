import { doAudioProcessing, sampleSize } from "./MicSharedFuns";

class PitchFinderWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this.largerBufferSize = sampleSize;
    this.largerBuffer = new Float32Array(this.largerBufferSize);
    this.bufferPosition = 0;
  }

  process(inputs) {
    if (!inputs[0] || !inputs[0][0]) return true;

    this.largerBuffer.set(inputs[0][0], this.bufferPosition);
    this.bufferPosition = (this.bufferPosition + 128) % this.largerBufferSize;

    if (this.bufferPosition === 0) {
      this.port.postMessage(doAudioProcessing(this.largerBuffer));
    }

    return true;
  }
}

registerProcessor('pitch-finder-worklet', PitchFinderWorklet);
