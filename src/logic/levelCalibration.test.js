import { describe, it, expect } from 'vitest';
import { createLevelCalibration, VOICE_TARGET, MAX_GAIN } from './levelCalibration';

const sure = volume => ({ volume, pitchHz: 220, confidence: 0.98 });

describe('createLevelCalibration', () => {
  it('starts without a boost', () => {
    expect(createLevelCalibration().gain()).toBe(1);
  });

  it('boosts a quiet voice toward the target level, slowly', () => {
    const c = createLevelCalibration({ stepSeconds: 0.03 });
    c.update(sure(0.02));
    expect(c.gain()).toBeLessThan(1.1); // one window hardly moves it
    for (let i = 0; i < 600; i++) c.update(sure(0.02)); // ~20 s of singing
    expect(c.gain()).toBeGreaterThan(0.95 * VOICE_TARGET / 0.02);
    expect(c.gain()).toBeLessThan(1.05 * VOICE_TARGET / 0.02);
  });

  it('never turns a loud mic down, nor boosts beyond the cap', () => {
    const loud = createLevelCalibration({ stepSeconds: 0.03 });
    for (let i = 0; i < 600; i++) loud.update(sure(0.6));
    expect(loud.gain()).toBe(1);
    const faint = createLevelCalibration({ stepSeconds: 0.03 });
    for (let i = 0; i < 3000; i++) faint.update(sure(0.0005));
    expect(faint.gain()).toBe(MAX_GAIN);
  });

  it('only learns from windows the model is sure are a voice', () => {
    const c = createLevelCalibration({ stepSeconds: 0.03 });
    for (let i = 0; i < 600; i++) {
      c.update({ volume: 0.01, pitchHz: 220, confidence: 0.9 }); // unsure
      c.update({ volume: 0.01, pitchHz: 0, confidence: 0.99 });  // no pitch
      c.update({ volume: 0, pitchHz: 220, confidence: 0.99 });   // silence
    }
    expect(c.gain()).toBe(1);
  });

  it('adapts at the same speed per second whatever the window step', () => {
    const fast = createLevelCalibration({ stepSeconds: 0.015 });
    const slow = createLevelCalibration({ stepSeconds: 0.03 });
    for (let i = 0; i < 400; i++) fast.update(sure(0.03));
    for (let i = 0; i < 200; i++) slow.update(sure(0.03));
    expect(slow.gain()).toBeCloseTo(fast.gain(), 6);
  });
});
