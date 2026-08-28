import { describe, it, expect } from 'vitest';
import { AcousticEchoCanceller } from './AcousticEchoCanceller';

describe('AcousticEchoCanceller', () => {
  it('initializes and manages reference state', () => {
    const aec = new AcousticEchoCanceller({ delaySamples: 800 });
    expect(aec.hasReference()).toBe(false);

    // Feed reference audio
    const ref = new Float32Array(2000);
    aec.feedReference(ref);
    expect(aec.hasReference()).toBe(true);

    aec.reset();
    expect(aec.hasReference()).toBe(false);
  });

  it('cancels reference speaker bleed from microphone audio', () => {
    const aec = new AcousticEchoCanceller({ delaySamples: 0, filterLen: 128, stepSize: 0.25 });
    const sampleRate = 16000;
    const numSamples = 16000 * 2; // 2 seconds

    // 440 Hz reference tone
    const refAudio = new Float32Array(numSamples);
    for (let i = 0; i < numSamples; i++) {
      refAudio[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / sampleRate);
    }

    // Microphone audio consists ONLY of speaker bleed (e.g. 30% reference amplitude)
    const micAudio = new Float32Array(numSamples);
    for (let i = 0; i < numSamples; i++) {
      micAudio[i] = 0.3 * refAudio[i];
    }

    // Process chunk by chunk
    const chunkSize = 960;
    const cleaned = new Float32Array(numSamples);

    for (let pos = 0; pos + chunkSize <= numSamples; pos += chunkSize) {
      const refChunk = refAudio.subarray(pos, pos + chunkSize);
      const micChunk = micAudio.subarray(pos, pos + chunkSize);

      aec.feedReference(refChunk);
      const outChunk = aec.processChunk(micChunk);
      cleaned.set(outChunk, pos);
    }

    // Measure attenuation during the second second (after filter converges)
    const secondHalfStart = 16000;
    let rawBleedPower = 0;
    let cleanedPower = 0;
    for (let i = secondHalfStart; i < numSamples; i++) {
      rawBleedPower += micAudio[i] * micAudio[i];
      cleanedPower += cleaned[i] * cleaned[i];
    }

    // Cleaned power should be significantly smaller than raw bleed (> 10dB attenuation)
    const attenuationRatio = cleanedPower / rawBleedPower;
    expect(attenuationRatio).toBeLessThan(0.35);
  });

  it('preserves user voice during simultaneous double-talk', () => {
    const aec = new AcousticEchoCanceller({ delaySamples: 0, filterLen: 128, stepSize: 0.15 });
    const sampleRate = 16000;
    const numSamples = 16000 * 2;

    // 880 Hz background music
    const refAudio = new Float32Array(numSamples);
    for (let i = 0; i < numSamples; i++) {
      refAudio[i] = 0.2 * Math.sin((2 * Math.PI * 880 * i) / sampleRate);
    }

    // 220 Hz user voice (louder) + 880 Hz bleed
    const userVoice = new Float32Array(numSamples);
    const micAudio = new Float32Array(numSamples);
    for (let i = 0; i < numSamples; i++) {
      userVoice[i] = 0.6 * Math.sin((2 * Math.PI * 220 * i) / sampleRate);
      micAudio[i] = userVoice[i] + 0.15 * refAudio[i];
    }

    const chunkSize = 960;
    const cleaned = new Float32Array(numSamples);

    for (let pos = 0; pos + chunkSize <= numSamples; pos += chunkSize) {
      const refChunk = refAudio.subarray(pos, pos + chunkSize);
      const micChunk = micAudio.subarray(pos, pos + chunkSize);

      aec.feedReference(refChunk);
      const outChunk = aec.processChunk(micChunk);
      cleaned.set(outChunk, pos);
    }

    // Measure user voice energy preservation in second half
    let userPower = 0;
    let cleanedPower = 0;
    for (let i = 16000; i < numSamples; i++) {
      userPower += userVoice[i] * userVoice[i];
      cleanedPower += cleaned[i] * cleaned[i];
    }

    // User voice energy should be well preserved (within 25% of original user signal)
    const energyRatio = cleanedPower / userPower;
    expect(energyRatio).toBeGreaterThan(0.70);
    expect(energyRatio).toBeLessThan(1.30);
  });
});
