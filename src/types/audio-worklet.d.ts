// The AudioWorklet's global scope (PitchFinderWorklet.ts), which TypeScript has no lib for: the
// parts of AudioWorkletGlobalScope (Web Audio API) the worklet uses or may. Listed in
// tsconfig.worker.json; the page's project includes it with the rest of src, where the worklet's
// unit test stands these globals in.
export {};

declare global {
  /**
   * What the AudioWorkletNode was created with, handed to the processor's
   * constructor. P: what the page passes as processorOptions (a structured
   * clone, like a message's data).
   */
  interface AudioWorkletProcessorOptions<P = unknown> {
    numberOfInputs?: number;
    numberOfOutputs?: number;
    outputChannelCount?: number[];
    parameterData?: Record<string, number>;
    /** whatever the page passed (a structured clone) */
    processorOptions?: P;
  }

  /** The base class of a processor: its end of the node's MessagePort */
  interface AudioWorkletProcessor {
    readonly port: MessagePort;
  }

  var AudioWorkletProcessor: {
    prototype: AudioWorkletProcessor;
    new (): AudioWorkletProcessor;
  };

  /** A processor class as registerProcessor takes it: process() renders one quantum, false lets it go */
  interface AudioWorkletProcessorConstructor<P = unknown> {
    new (options: AudioWorkletProcessorOptions<P>): AudioWorkletProcessor & {
      process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
    };
  }

  function registerProcessor<P>(name: string, processorCtor: AudioWorkletProcessorConstructor<P>): void;

  /** The context's sample rate (Hz) */
  var sampleRate: number;
  /** The context's time (s) of the quantum being rendered */
  var currentTime: number;
  /** The frame of the quantum being rendered */
  var currentFrame: number;
}
