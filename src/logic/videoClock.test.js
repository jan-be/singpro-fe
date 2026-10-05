import { describe, it, expect } from 'vitest';
import { VideoClock, readPlayer, LEAK, SEEK_GRACE } from './videoClock';

// A report the way the IFrame API holds it: the video's time `time` taken at `at`
const rep = (time, at, state = 1, rate = 1) => ({ time, at, state, rate });

// A deterministic stand-in for Math.random
function rng(seed) { let s = seed; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; }

describe('VideoClock', () => {
  it('knows nothing before the first report', () => {
    const c = new VideoClock();
    expect(c.timeAt(100)).toBe(null);
    expect(c.info(100).mode).toBe('unknown');
  });

  it('extrapolates a playing video from its report, without the API\'s one-second cap', () => {
    const c = new VideoClock();
    c.observe(rep(10, 1000), 1000.05);
    expect(c.mode).toBe('playing');
    expect(c.timeAt(1000.5)).toBeCloseTo(10.5, 6);
    expect(c.timeAt(1004)).toBeCloseTo(14, 6);
  });

  it('keeps the highest bound: a stale report never pulls the estimate back', () => {
    const c = new VideoClock();
    c.observe(rep(10, 1000), 1000);
    c.observe(rep(10.4, 1001), 1001.2); // taken 0.6 s before its stamp
    expect(c.timeAt(1002)).toBeCloseTo(12 - LEAK, 6);
    expect(c.info(1002).lag).toBeCloseTo(0.6 - LEAK, 6);
    c.observe(rep(12, 1002), 1002); // a fresh one
    expect(c.timeAt(1003)).toBeCloseTo(13, 6);
    expect(c.info(1003).lag).toBe(0);
  });

  it('rises at once with a fresher report (the first ones may have been stale)', () => {
    const c = new VideoClock();
    c.observe(rep(9, 1000), 1000); // 1 s stale
    expect(c.timeAt(1000)).toBeCloseTo(9, 6);
    c.observe(rep(10.5, 1000.5), 1000.6);
    expect(c.timeAt(1001)).toBeCloseTo(11, 6);
  });

  it('ignores repeats of the same report', () => {
    const c = new VideoClock();
    c.observe(rep(10, 1000), 1000);
    c.observe(rep(10, 1000), 1003);
    expect(c.reports).toBe(1);
    expect(c.timeAt(1003)).toBeCloseTo(13, 6);
  });

  it('tracks the video within a few ms through a starved stream where the API is seconds off', () => {
    // The picture plays from 5 s at wall 1000; reports are taken late (their
    // time 0–2.5 s old at the stamp, now and then fresh) and arrive late too
    const random = rng(12345);
    const truth = (w) => 5 + (w - 1000);
    const c = new VideoClock();
    let worstClock = 0, worstApi = 0, last = null, n = 0;
    for (let w = 1000; w < 1060; w += 0.1) {
      if (random() < 0.15) {
        const stale = n++ % 6 === 0 ? random() * 0.01 : random() * 2.5;
        last = rep(truth(w) - stale, w);
      }
      if (!last) continue;
      const seen = w + 0.05; // read a little after
      c.observe(last, seen);
      if (w < 1005) continue;
      worstClock = Math.max(worstClock, Math.abs(c.timeAt(seen) - truth(seen)));
      const api = last.time + Math.min(1, seen - last.at); // the IFrame API's getCurrentTime()
      worstApi = Math.max(worstApi, Math.abs(api - truth(seen)));
    }
    expect(worstClock).toBeLessThan(0.03);
    expect(worstApi).toBeGreaterThan(1);
  });

  it('stands still while paused or buffering and starts a new epoch on playing', () => {
    const c = new VideoClock();
    c.observe(rep(10, 1000), 1000);
    const e = c.epoch;
    c.observe(rep(12, 1002, 3), 1002.1); // buffering
    expect(c.mode).toBe('stopped');
    expect(c.timeAt(1005)).toBe(12);
    expect(c.epoch).toBe(e + 1);
    c.observe(rep(12, 1006, 1), 1006.2);
    expect(c.mode).toBe('playing');
    expect(c.epoch).toBe(e + 2);
    expect(c.timeAt(1007)).toBeCloseTo(13, 6);
  });

  it('takes a new state that comes without a new time as starting no earlier than when it was read', () => {
    const c = new VideoClock();
    c.observe(rep(30, 1000, 2), 1000); // paused at 30
    c.observe(rep(30, 1000, 1), 1010); // the API says playing again, still with the paused report
    expect(c.mode).toBe('playing');
    expect(c.timeAt(1010)).toBeCloseTo(30, 6); // not 40: it stood there until it was read
    expect(c.timeAt(1011)).toBeCloseTo(31, 6);
  });

  it('holds a seek of ours at the target until a report shows it, ignoring the older ones', () => {
    const c = new VideoClock();
    c.observe(rep(50, 1000), 1000);
    c.seeked(20, 1001);
    expect(c.mode).toBe('seeking');
    expect(c.timeAt(1001.5)).toBe(20);
    c.observe(rep(50.8, 1000.8), 1001.2); // taken before the seek
    c.observe(rep(51.1, 1001.1), 1001.4); // stamped after it, but still the old time
    expect(c.mode).toBe('seeking');
    expect(c.timeAt(1001.6)).toBe(20);
    c.observe(rep(20.1, 1001.6), 1001.7);
    expect(c.mode).toBe('playing');
    expect(c.timeAt(1002.6)).toBeCloseTo(21.1, 6);
  });

  it('gives up waiting for a seek to show after the grace and takes what comes', () => {
    const c = new VideoClock();
    c.observe(rep(50, 1000), 1000);
    c.seeked(20, 1001);
    c.observe(rep(60, 1001.5), 1001 + SEEK_GRACE + 0.1);
    expect(c.mode).toBe('playing');
    expect(c.timeAt(1001 + SEEK_GRACE + 0.1)).toBeCloseTo(60 + SEEK_GRACE - 0.4, 6);
  });

  it('settles a seek while paused as stopped at the new place', () => {
    const c = new VideoClock();
    c.observe(rep(50, 1000, 2), 1000);
    c.seeked(80, 1001);
    c.observe(rep(80, 1001.3, 2), 1001.4);
    expect(c.mode).toBe('stopped');
    expect(c.timeAt(1003)).toBe(80);
  });

  it('starts over on a change of playback rate', () => {
    const c = new VideoClock();
    c.observe(rep(10, 1000), 1000);
    c.observe(rep(11, 1001, 1, 1.25), 1001);
    expect(c.rate).toBe(1.25);
    expect(c.timeAt(1003)).toBeCloseTo(13.5, 6);
  });
});

describe('readPlayer', () => {
  it('reads the report the IFrame API keeps', () => {
    const player = { playerInfo: { currentTime: 12.5, currentTimeLastUpdated_: 1700000000.25, playerState: 1, playbackRate: 1 }, getCurrentTime: () => 99 };
    expect(readPlayer(player)).toEqual({ time: 12.5, at: 1700000000.25, state: 1, rate: 1 });
  });

  it('falls back to getCurrentTime() taken now when the internals are not there', () => {
    const player = { getCurrentTime: () => 7, getPlayerState: () => 2, getPlaybackRate: () => 1 };
    expect(readPlayer(player, 500)).toEqual({ time: 7, at: 500, state: 2, rate: 1 });
  });

  it('is null without a player or a time, and survives a destroyed one', () => {
    expect(readPlayer(null)).toBe(null);
    expect(readPlayer({ getCurrentTime: () => undefined })).toBe(null);
    expect(readPlayer({ get playerInfo() { throw new Error('gone'); } })).toBe(null);
  });
});
