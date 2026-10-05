import { describe, it, expect } from 'vitest';
import { createStruggleWatch, initialVideoScale, rememberReducedScale, syncVideoScaleFromUrl, forcedVideoScale, reducedVideoScale, softwareAv1OnWeakDevice } from './videoScale';

const store = () => {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
};

/** Feeds `seconds` of frames `every` ms apart (or a pattern of intervals, repeated); returns whether the watch decided. */
const feed = (watch, { from = 0, seconds, every, pattern, playing = true }) => {
  const steps = pattern ?? [every];
  let t = from, decided = false, i = 0;
  while (t < from + seconds * 1000) { decided = watch.frame(t, playing); t += steps[i++ % steps.length]; }
  return { decided, t };
};

describe('createStruggleWatch', () => {
  it('stays quiet at a fluent frame rate, and at a slow display\'s own rate', () => {
    expect(feed(createStruggleWatch(), { seconds: 60, every: 16.7 }).decided).toBe(false);
    expect(feed(createStruggleWatch(), { seconds: 60, every: 33.3 }).decided).toBe(false); // 30 fps on 60 Hz: the governor's job
    expect(feed(createStruggleWatch(), { seconds: 60, every: 40 }).decided).toBe(false);   // a 25 Hz display
  });

  it('decides after eight seconds of playback at a starved rate', () => {
    const w = createStruggleWatch();
    let { decided, t } = feed(w, { seconds: 1, every: 16.7 }); // the display's rate, seen once
    expect(decided).toBe(false);
    ({ decided, t } = feed(w, { from: t, seconds: 6, every: 120 }));
    expect(decided).toBe(false);
    ({ decided } = feed(w, { from: t, seconds: 4, every: 120 }));
    expect(decided).toBe(true);
    expect(w.frame(t + 100_000, false)).toBe(true); // and stays decided
  });

  it('sees starvation in bursts of quick frames between stalls, where the median interval looks fine', () => {
    // three frames at the display's rate, then a 300 ms stall: ~11 frames a second
    expect(feed(createStruggleWatch(), { seconds: 12, pattern: [16.7, 16.7, 16.7, 300] }).decided).toBe(true);
  });

  it('takes slow moments (a song starting, a stall) for what they are', () => {
    const w = createStruggleWatch();
    let { t } = feed(w, { seconds: 1, every: 16.7 });
    for (let i = 0; i < 5; i++) {
      ({ t } = feed(w, { from: t, seconds: 5, every: 150 }));
      ({ t } = feed(w, { from: t, seconds: 2, every: 16.7 }));
    }
    expect(w.frame(t, true)).toBe(false);
  });

  it('counts only playback, and no frame gap across a pause or a hidden tab', () => {
    const w = createStruggleWatch();
    let { t } = feed(w, { seconds: 1, every: 16.7 });
    for (let i = 0; i < 20; i++) { w.frame(t, true); t += 16.7; w.frame(t, false); t += 3000; } // playing in snippets
    expect(w.frame(t, true)).toBe(false);
    for (let i = 0; i < 10; i++) { t += 5000; expect(w.frame(t, true)).toBe(false); } // a hidden tab's rare frames
  });
});

describe('the chosen scale', () => {
  it('sizes the reduced player for about 540 device px of height', () => {
    expect(reducedVideoScale(960, 540, 4)).toBe(4);    // Silk on a Fire TV stick: 1080p -> 720p
    expect(reducedVideoScale(960, 540, 2)).toBe(2);    // a 1080p TV at 2x
    expect(reducedVideoScale(1280, 400, 1)).toBe(1);   // already small: never scaled up beyond the stage
    expect(reducedVideoScale(8000, 4000, 4)).toBe(8);  // capped
    // a phone in portrait: the picture is as tall as its width allows, not the screen
    expect(reducedVideoScale(412, 915, 2.625)).toBeCloseTo((412 * 9 / 16) * 2.625 / 540, 6);
  });

  it('starts at full size, reduced once this visit decided so', () => {
    const local = store(), session = store();
    expect(initialVideoScale(local, session, () => 4)).toBe(1);
    rememberReducedScale(session);
    expect(initialVideoScale(local, session, () => 4)).toBe(4);
  });

  it('follows ?videoscale= over the watch', () => {
    const local = store(), session = store();
    rememberReducedScale(session);
    syncVideoScaleFromUrl('?videoscale=1', local);
    expect(forcedVideoScale(local)).toBe(1);
    expect(initialVideoScale(local, session, () => 4)).toBe(1);
    syncVideoScaleFromUrl('?debug=1', local); // other parameters leave it alone
    expect(forcedVideoScale(local)).toBe(1);
    syncVideoScaleFromUrl('?videoscale=0', local);
    expect(forcedVideoScale(local)).toBe(null);
    expect(initialVideoScale(local, session, () => 4)).toBe(4);
    syncVideoScaleFromUrl('?videoscale=3', local);
    expect(initialVideoScale(local, store(), () => 4)).toBe(3);
  });
});

describe('softwareAv1OnWeakDevice', () => {
  const nav = (deviceMemory, av1Hw, vp9Hw) => ({
    deviceMemory,
    mediaCapabilities: { decodingInfo: async ({ video }) => ({ supported: true, smooth: true, powerEfficient: video.contentType.includes('av01') ? av1Hw : vp9Hw }) },
  });
  it('is the Fire TV stick in Silk: AV1 in software, VP9 in hardware, 2 GB', async () => {
    expect(await softwareAv1OnWeakDevice(nav(2, false, true))).toBe(true);
  });
  it('is not a device with AV1 hardware, nor one with more memory, nor one without the API', async () => {
    expect(await softwareAv1OnWeakDevice(nav(2, true, true))).toBe(false);
    expect(await softwareAv1OnWeakDevice(nav(8, false, true))).toBe(false);
    expect(await softwareAv1OnWeakDevice({ deviceMemory: 2 })).toBe(false);
    expect(await softwareAv1OnWeakDevice({})).toBe(false); // Safari, Firefox: no deviceMemory
  });
});
