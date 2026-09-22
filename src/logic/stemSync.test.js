import { describe, it, expect } from 'vitest';
import { planStemSync, SEEK_COOLDOWN, MAX_RATE_DELTA, DEADBAND } from './stemSync';

const step = (o) => planStemSync({ videoTime: 10, karaokeTime: 10, vocalsTime: 10, now: 100, ...o });

describe('planStemSync', () => {
  it('leaves aligned stems alone', () => {
    expect(step({})).toEqual({ karaokeRate: 1, vocalsRate: 1 });
  });

  it('chases a small vocals drift with the rate, in the direction of the drift', () => {
    expect(step({ vocalsTime: 9.9 }).vocalsRate).toBeCloseTo(1.03);
    expect(step({ vocalsTime: 10.1 }).vocalsRate).toBeCloseTo(0.97);
    expect(step({ vocalsTime: 9.5 }).vocalsRate).toBeCloseTo(1 + MAX_RATE_DELTA); // clamped
    expect(step({ vocalsTime: 9.9 }).seekVocals).toBeUndefined();
  });

  it('adds the vocals correction on top of the karaoke rate', () => {
    const plan = step({ karaokeTime: 9.9, vocalsTime: 9.8 }); // karaoke 0.1 behind the video, vocals 0.1 behind the karaoke
    expect(plan.karaokeRate).toBeCloseTo(1.03);
    expect(plan.vocalsRate).toBeCloseTo(1.06);
  });

  it('seeks a large drift, then not again within the cooldown', () => {
    expect(step({ vocalsTime: 9.2 }).seekVocals).toBe(10);
    const during = step({ vocalsTime: 9.2, lastSeekAt: 100 - SEEK_COOLDOWN + 0.5 });
    expect(during.seekVocals).toBeUndefined();
    expect(during.vocalsRate).toBeCloseTo(1 + MAX_RATE_DELTA);
    expect(step({ vocalsTime: 9.2, lastSeekAt: 100 - SEEK_COOLDOWN }).seekVocals).toBe(10);
  });

  it('never seeks an element that is still seeking, and holds the vocals while the karaoke seeks', () => {
    expect(step({ vocalsTime: 9.2, vocalsSeeking: true })).toEqual({ karaokeRate: 1, vocalsRate: 1 });
    expect(step({ karaokeTime: 9, vocalsTime: 9, karaokeSeeking: true })).toEqual({ karaokeRate: 1, vocalsRate: 1 });
  });

  it('takes the vocals along when the karaoke seeks to the video', () => {
    expect(step({ karaokeTime: 9.5, vocalsTime: 9.5 })).toEqual({ karaokeRate: 1, vocalsRate: 1, seekKaraoke: 10, seekVocals: 10 });
  });

  it('a start seeks whatever is off, cooldown or not, at rate 1', () => {
    expect(step({ karaokeTime: 9.8, vocalsTime: 10.05, immediate: true, lastSeekAt: 100 }))
      .toEqual({ karaokeRate: 1, vocalsRate: 1, seekKaraoke: 10 });
  });

  it('works without a vocals track', () => {
    const plan = step({ vocalsTime: undefined, karaokeTime: 9.9 });
    expect(plan.karaokeRate).toBeCloseTo(1.03);
    expect(plan.vocalsRate).toBe(1);
    expect(plan.seekVocals).toBeUndefined();
  });
});

// Two <audio> elements on iOS: a seek takes SEEK_LATENCY, during which the
// element stands still; the other keeps running. The sync is checked every
// 0.5 s like the page does.
function simulate({ vocalsBehind, seconds = 12, seekLatency = 0.3 }) {
  const el = (t) => ({ time: t, rate: 1, seekUntil: -1 });
  const k = el(0), v = el(-vocalsBehind);
  let video = 0, now = 0, lastSeekAt = -Infinity, seeks = 0;
  const tick = (e, dt) => { if (now < e.seekUntil) return; e.time += dt * e.rate; };
  for (let i = 0; i < seconds / 0.5; i++) {
    now += 0.5; video += 0.5; tick(k, 0.5); tick(v, 0.5);
    const plan = planStemSync({
      videoTime: video, karaokeTime: k.time, vocalsTime: v.time,
      karaokeSeeking: now < k.seekUntil, vocalsSeeking: now < v.seekUntil, now, lastSeekAt,
    });
    for (const [e, target] of [[k, plan.seekKaraoke], [v, plan.seekVocals]]) {
      if (target === undefined) continue;
      e.time = target; e.seekUntil = now + seekLatency; lastSeekAt = now; seeks++;
    }
    k.rate = plan.karaokeRate; v.rate = plan.vocalsRate;
  }
  return { seeks, karaokeDrift: video - k.time, vocalsDrift: k.time - v.time };
}

describe('two stems on iOS (seeks take 300 ms)', () => {
  it('a start-latency drift converges without a single seek', () => {
    const r = simulate({ vocalsBehind: 0.2 });
    expect(r.seeks).toBe(0);
    expect(Math.abs(r.vocalsDrift)).toBeLessThan(DEADBAND);
  });

  it('a large drift takes one seek, not a seek every check', () => {
    const r = simulate({ vocalsBehind: 0.8 });
    expect(r.seeks).toBe(1);
    expect(Math.abs(r.vocalsDrift)).toBeLessThan(DEADBAND);
  });
});
