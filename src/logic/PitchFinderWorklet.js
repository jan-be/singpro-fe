import { doAudioProcessing, sampleSize } from "./MicSharedFuns";

class PitchFinderWorklet extends AudioWorkletProcessor {
  largerBufferSize = sampleSize;
  largerBuffer = new Float32Array(this.largerBufferSize);
  bufferPosition = 0;

  process(inputs) {
    this.largerBuffer.set(inputs[0][0], this.bufferPosition);

    this.bufferPosition = (this.bufferPosition + 128) % this.largerBufferSize;

    if (this.bufferPosition === 0) {
      this.port.postMessage(doAudioProcessing(this.largerBuffer));
    }

    return true
  }
}

registerProcessor('pitch-finder-worklet', PitchFinderWorklet);
