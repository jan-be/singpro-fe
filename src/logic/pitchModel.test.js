import { describe, it, expect } from 'vitest';
import { pickPitch, CONFIDENCE_THRESHOLD, MIN_PITCH_HZ, MAX_PITCH_HZ } from './pitchModel';

describe('pickPitch', () => {
  it('returns the last frame when the model is confident', () => {
    expect(pickPitch(new Float32Array([200, 210, 220]), new Float32Array([0.9, 0.9, 0.95]))).toBe(220);
  });
  it('returns 0 when the last frame is not confident, whatever the earlier frames say', () => {
    expect(pickPitch(new Float32Array([200, 210, 220]), new Float32Array([0.99, 0.99, CONFIDENCE_THRESHOLD - 0.01]))).toBe(0);
  });
  it('accepts the threshold itself', () => {
    expect(pickPitch([440], [CONFIDENCE_THRESHOLD])).toBe(440);
  });
  it('rejects pitches outside the singing range', () => {
    expect(pickPitch([MIN_PITCH_HZ - 1], [1])).toBe(0);
    expect(pickPitch([MAX_PITCH_HZ + 1], [1])).toBe(0);
    expect(pickPitch([MIN_PITCH_HZ], [1])).toBe(MIN_PITCH_HZ);
  });
  it('handles empty output', () => {
    expect(pickPitch(new Float32Array(0), new Float32Array(0))).toBe(0);
    expect(pickPitch(undefined, undefined)).toBe(0);
  });
});
