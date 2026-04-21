import { describe, it, expect } from 'vitest';
import { resample, hzToSemitone, noteIntFromPitch, RMS_SILENCE_THRESHOLD, RMS_SILENCE_FLOOR, createNoiseGate } from './MicSharedFuns.js';

describe('noteIntFromPitch', () => {
  it('converts A4 (440 Hz) to MIDI 69', () => {
    expect(noteIntFromPitch(440)).toBe(69);
  });

  it('converts C4 (261.63 Hz) to MIDI 60', () => {
    expect(noteIntFromPitch(261.63)).toBe(60);
  });

  it('converts A3 (220 Hz) to MIDI 57', () => {
    expect(noteIntFromPitch(220)).toBe(57);
  });

  it('converts C5 (523.25 Hz) to MIDI 72', () => {
    expect(noteIntFromPitch(523.25)).toBe(72);
  });

  it('converts E2 (82.41 Hz) to MIDI 40', () => {
    expect(noteIntFromPitch(82.41)).toBe(40);
  });

  it('converts B5 (987.77 Hz) to MIDI 83', () => {
    expect(noteIntFromPitch(987.77)).toBe(83);
  });

  // Edge cases around rounding boundaries
  it('rounds to nearest semitone', () => {
    // 452.9 Hz is ~49 cents above A4 — actually rounds to 70 (Bb4) since
    // 12 * log2(452.9/440) ≈ 0.503, Math.round(0.503) = 1 → MIDI 70
    expect(noteIntFromPitch(452.9)).toBe(70);
    expect(noteIntFromPitch(466.16)).toBe(70); // Bb4
    // 445 Hz is ~20 cents above A4 — still rounds to 69
    expect(noteIntFromPitch(445)).toBe(69);
  });
});

describe('hzToSemitone', () => {
  it('converts A4 (440 Hz) to UltraStar tone 33', () => {
    expect(hzToSemitone(440)).toBeCloseTo(33, 5);
  });

  it('converts C4 (261.63 Hz) to UltraStar tone ~24', () => {
    expect(hzToSemitone(261.63)).toBeCloseTo(24, 0);
  });

  it('converts A3 (220 Hz) to UltraStar tone 21', () => {
    expect(hzToSemitone(220)).toBeCloseTo(21, 5);
  });

  it('converts C5 (523.25 Hz) to UltraStar tone ~36', () => {
    expect(hzToSemitone(523.25)).toBeCloseTo(36, 0);
  });

  it('returns continuous float (sub-semitone precision)', () => {
    const tone = hzToSemitone(450); // slightly above A4
    expect(tone).toBeGreaterThan(33);
    expect(tone).toBeLessThan(34);
    // Should not be an integer
    expect(tone % 1).not.toBeCloseTo(0, 2);
  });

  it('agrees with noteIntFromPitch after rounding (MIDI-36 = UltraStar)', () => {
    for (const freq of [220, 261.63, 329.63, 440, 523.25, 659.26, 880]) {
      const fromHzToSemitone = Math.round(hzToSemitone(freq));
      const fromNoteInt = noteIntFromPitch(freq) - 36;
      expect(fromHzToSemitone).toBe(fromNoteInt);
    }
  });
});

describe('resample', () => {
  it('returns the same array when source and target rates are equal', () => {
    const input = new Float32Array([1, 2, 3, 4, 5]);
    const output = resample(input, 16000, 16000);
    expect(output).toBe(input); // same reference
  });

  it('upsamples from 12kHz to 16kHz (ratio 4/3)', () => {
    // 3 samples at 12kHz → 4 samples at 16kHz
    const input = new Float32Array([0, 1, 0]);
    const output = resample(input, 12000, 16000);

    // Output should be 4 samples
    expect(output.length).toBe(4);

    // First sample maps to index 0
    expect(output[0]).toBeCloseTo(0, 5);
    // Last sample maps near index 2
    // Linear interpolation expected
  });

  it('preserves signal energy approximately for sine wave', () => {
    const srcRate = 12000;
    const tgtRate = 16000;
    const freq = 440; // A4
    const duration = 0.1; // 100ms
    const srcLen = Math.floor(srcRate * duration);

    // Generate sine wave at srcRate
    const input = new Float32Array(srcLen);
    for (let i = 0; i < srcLen; i++) {
      input[i] = Math.sin(2 * Math.PI * freq * i / srcRate);
    }

    const output = resample(input, srcRate, tgtRate);

    // Output length should be ~ srcLen * (tgtRate / srcRate)
    const expectedLen = Math.ceil(srcLen * tgtRate / srcRate);
    expect(output.length).toBe(expectedLen);

    // RMS should be approximately the same (sine wave RMS = 1/sqrt(2) ≈ 0.707)
    const srcRms = Math.sqrt(input.reduce((s, x) => s + x * x, 0) / input.length);
    const outRms = Math.sqrt(output.reduce((s, x) => s + x * x, 0) / output.length);
    expect(outRms).toBeCloseTo(srcRms, 1);
  });

  it('downsamples from 16kHz to 12kHz', () => {
    const input = new Float32Array([0, 0.25, 0.5, 0.75, 1, 0.75, 0.5, 0.25]);
    const output = resample(input, 16000, 12000);
    // 8 samples at 16kHz → 6 samples at 12kHz
    expect(output.length).toBe(6);
  });

  it('handles single sample input', () => {
    const input = new Float32Array([0.5]);
    const output = resample(input, 12000, 16000);
    expect(output.length).toBeGreaterThanOrEqual(1);
    // First sample should be 0.5
    expect(output[0]).toBeCloseTo(0.5, 5);
  });

  it('resampled 440Hz sine is detected at same frequency', () => {
    // Generate 1280 samples at 12kHz (the actual worklet window size)
    const srcRate = 12000;
    const tgtRate = 16000;
    const freq = 440;
    const srcLen = 1280;

    const input = new Float32Array(srcLen);
    for (let i = 0; i < srcLen; i++) {
      input[i] = Math.sin(2 * Math.PI * freq * i / srcRate);
    }

    const output = resample(input, srcRate, tgtRate);

    // Verify the resampled signal has the right frequency by checking zero crossings
    let zeroCrossings = 0;
    for (let i = 1; i < output.length; i++) {
      if ((output[i - 1] >= 0) !== (output[i] >= 0)) zeroCrossings++;
    }

    // Expected zero crossings ≈ 2 * freq * (output.length / tgtRate)
    const expectedCrossings = 2 * freq * (output.length / tgtRate);
    // Allow ±2 crossings tolerance (integer vs float)
    expect(Math.abs(zeroCrossings - expectedCrossings)).toBeLessThan(2);
  });
});

describe('createNoiseGate', () => {
  it('gates all frames during calibration phase (first 8 frames)', () => {
    const gate = createNoiseGate();
    for (let i = 0; i < 8; i++) {
      expect(gate.shouldGate(0.01)).toBe(true);
    }
  });

  it('passes loud frames after calibration', () => {
    const gate = createNoiseGate();
    // Calibration with quiet noise
    for (let i = 0; i < 8; i++) gate.shouldGate(0.005);
    // A frame well above the noise floor should pass
    expect(gate.shouldGate(0.05)).toBe(false);
  });

  it('gates quiet frames after calibration', () => {
    const gate = createNoiseGate();
    // Calibrate with noise at 0.005
    for (let i = 0; i < 8; i++) gate.shouldGate(0.005);
    // A frame at the noise floor level should be gated (2x multiplier)
    expect(gate.shouldGate(0.005)).toBe(true);
    expect(gate.shouldGate(0.008)).toBe(true);
  });

  it('adapts to different noise floor levels', () => {
    const gateLow = createNoiseGate();
    const gateHigh = createNoiseGate();

    // Low noise floor
    for (let i = 0; i < 8; i++) gateLow.shouldGate(0.002);
    // High noise floor
    for (let i = 0; i < 8; i++) gateHigh.shouldGate(0.02);

    // Both should pass frames that are 3x their respective noise floors
    expect(gateLow.shouldGate(0.01)).toBe(false);
    expect(gateHigh.shouldGate(0.1)).toBe(false);

    // Both should gate frames at their respective noise levels
    expect(gateLow.shouldGate(0.002)).toBe(true);
    expect(gateHigh.shouldGate(0.02)).toBe(true);
  });

  it('never goes below RMS_SILENCE_FLOOR', () => {
    const gate = createNoiseGate();
    // Calibrate with near-zero noise (digital silence)
    for (let i = 0; i < 8; i++) gate.shouldGate(0.0001);
    // Even a tiny signal should be gated because 2x noise < RMS_SILENCE_FLOOR
    // RMS_SILENCE_FLOOR is 0.002, so anything below that stays gated
    expect(gate.shouldGate(0.001)).toBe(true);
    // But a signal above the floor should pass
    expect(gate.shouldGate(0.01)).toBe(false);
  });

  it('tracks noise floor via getNoiseFloor()', () => {
    const gate = createNoiseGate();
    for (let i = 0; i < 8; i++) gate.shouldGate(0.01);
    const floor = gate.getNoiseFloor();
    expect(floor).toBeGreaterThan(0.005);
    expect(floor).toBeLessThan(0.015);
  });

  it('handles gain-scaled signals consistently', () => {
    // Simulate two mic gain levels — both should detect signal vs noise similarly
    const gateFull = createNoiseGate();
    const gateHalf = createNoiseGate();

    // Full gain: noise=0.01, signal=0.1
    for (let i = 0; i < 8; i++) gateFull.shouldGate(0.01);
    // Half gain: noise=0.005, signal=0.05
    for (let i = 0; i < 8; i++) gateHalf.shouldGate(0.005);

    // Both should pass their respective signal levels
    expect(gateFull.shouldGate(0.1)).toBe(false);
    expect(gateHalf.shouldGate(0.05)).toBe(false);

    // Both should gate their respective noise levels
    expect(gateFull.shouldGate(0.01)).toBe(true);
    expect(gateHalf.shouldGate(0.005)).toBe(true);
  });

  it('recovers quickly after a loud transient (mic bump)', () => {
    const gate = createNoiseGate();

    // Calibrate with quiet ambient noise
    for (let i = 0; i < 8; i++) gate.shouldGate(0.005);

    // Normal voice should pass
    expect(gate.shouldGate(0.08)).toBe(false);

    // Loud transient (mic bump) — passes through (not gated)
    expect(gate.shouldGate(0.5)).toBe(false);

    // Post-transient ringing: a burst of elevated "quiet" frames
    // These are below the signal threshold but above the noise floor.
    // They get gated, but they push the noise floor up.
    for (let i = 0; i < 20; i++) gate.shouldGate(0.03);

    // After the ringing subsides, normal voice (0.08) must still pass.
    // Without the noise floor cap, the floor would rise too high and
    // the threshold (floor * 2) would exceed 0.08, blocking voice.
    expect(gate.shouldGate(0.08)).toBe(false);
  });

  it('caps noise floor so loud calibration does not block voice', () => {
    const gate = createNoiseGate();

    // Calibrate in a very noisy environment
    for (let i = 0; i < 8; i++) gate.shouldGate(0.1);

    // Noise floor should be capped — voice at 0.1 should still pass
    // because the cap prevents the threshold from going above cap * 2 = 0.08
    expect(gate.getNoiseFloor()).toBeLessThanOrEqual(0.04);
    expect(gate.shouldGate(0.1)).toBe(false);
  });
});
