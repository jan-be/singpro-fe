import { describe, it, expect } from 'vitest';
import { pickPitch, createVoicingTracker, CONFIDENCE_THRESHOLD, MIN_PITCH_HZ, MAX_PITCH_HZ } from './pitchModel';

// One window's model output: earlier frames first, the window's own pitch last
const win = (hz, conf, prevHz = 0, prevConf = 0) => [new Float32Array([prevHz, hz]), new Float32Array([prevConf, conf])];
const HOP = 0.03;

describe('createVoicingTracker', () => {
  it('accepts a confident window like pickPitch', () => {
    const v = createVoicingTracker();
    expect(v.pick(...win(220, 0.97), 0)).toBeCloseTo(220);
  });

  it('rejects a lone borderline window (0.85–0.95): mostly instruments', () => {
    const v = createVoicingTracker();
    expect(v.pick(...win(220, 0.9), 0)).toBe(0);
  });

  it('accepts a borderline window that continues the previous one or its own earlier frame', () => {
    const v = createVoicingTracker();
    expect(v.pick(...win(220, 0.96), 0)).toBeCloseTo(220);
    expect(v.pick(...win(225, 0.9), HOP)).toBeCloseTo(225); // within a semitone, 30 ms later
    const w = createVoicingTracker();
    expect(w.pick(...win(220, 0.9, 222, 0.9), 0)).toBeCloseTo(220); // its own earlier frame agrees
    expect(w.pick(...win(220, 0.9, 330, 0.9), 1)).toBe(0); // …but not a fifth away
  });

  it('holds a sung note through unsure windows for 0.3 s after a sure one', () => {
    const v = createVoicingTracker();
    expect(v.pick(...win(220, 0.99), 0)).toBeCloseTo(220); // anchor
    expect(v.pick(...win(230, 0.3), 0.2)).toBeCloseTo(230);  // unsure, near the anchor: kept
    expect(v.pick(...win(440, 0.3), 0.25)).toBeCloseTo(440); // an octave up counts as the same note
    expect(v.pick(...win(330, 0.3), 0.28)).toBe(0);          // a fifth away is not the note
    expect(v.pick(...win(220, 0.3), 0.4)).toBe(0);           // hold over
    const w = createVoicingTracker();
    w.pick(...win(220, 0.99), 0);
    expect(w.pick(...win(220, 0.1), 0.1)).toBe(0);           // too unsure even while holding
  });

  it('accepts moderately sure windows inside a sustained phrase', () => {
    const v = createVoicingTracker();
    let t = 0;
    for (; t < 0.7; t += HOP) v.pick(...win(220, 0.99), t); // 0.7 s of anchors
    // far from the anchor pitch (no hold), but 0.6 confidence mid-phrase
    expect(v.pick(...win(330, 0.6), t + 0.5)).toBeCloseTo(330);
    expect(v.pick(...win(330, 0.4), t + 0.53)).toBe(0);
    // two seconds later the phrase is over
    expect(v.pick(...win(330, 0.6), t + 3)).toBe(0);
  });

  it('forgets everything across a jump of the clock (a paused song)', () => {
    const v = createVoicingTracker();
    for (let t = 0; t < 1; t += HOP) v.pick(...win(220, 0.99), t);
    expect(v.pick(...win(220, 0.6), 11)).toBe(0);
  });

  it('rejects pitches outside the singing range and empty output', () => {
    const v = createVoicingTracker();
    expect(v.pick(...win(MAX_PITCH_HZ + 1, 1), 0)).toBe(0);
    expect(v.pick(new Float32Array(0), new Float32Array(0), 0)).toBe(0);
  });
});

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
