import { describe, it, expect } from 'vitest';
import { shouldRestart, TOLERANCE, IMMEDIATE, HOLD_BEHIND, JUMP_BACK } from './stemSync';

describe('shouldRestart', () => {
  it('leaves stems alone within the tolerance', () => {
    const memo = {};
    expect(shouldRestart(TOLERANCE - 0.01, 0, memo)).toBe(false);
    expect(shouldRestart(-TOLERANCE + 0.01, 0.5, memo)).toBe(false);
  });

  it('follows at once when the clock is ahead: it is never early, so the stems are behind', () => {
    expect(shouldRestart(TOLERANCE + 0.01, 0, {})).toBe(true);
    expect(shouldRestart(2, 0, {})).toBe(true);
  });

  it('steps back only when the clock stays behind', () => {
    const memo = {};
    expect(shouldRestart(-0.3, 10, memo)).toBe(false);
    expect(shouldRestart(-0.3, 10.5, memo)).toBe(false);
    expect(shouldRestart(-0.3, 10 + HOLD_BEHIND, memo)).toBe(true);
    // and starts counting afresh after a restart
    expect(shouldRestart(-0.3, 12, memo)).toBe(false);
  });

  it('forgets a behind clock that caught up again (late news, not drift)', () => {
    const memo = {};
    expect(shouldRestart(-0.4, 10, memo)).toBe(false);
    expect(shouldRestart(0, 10.5, memo)).toBe(false);
    expect(shouldRestart(-0.4, 11, memo)).toBe(false);
    expect(shouldRestart(-0.4, 11 + HOLD_BEHIND - 0.01, memo)).toBe(false);
  });

  it('on a start or a seek of ours any difference beyond IMMEDIATE counts', () => {
    expect(shouldRestart(IMMEDIATE + 0.01, 0, {}, true)).toBe(true);
    expect(shouldRestart(-IMMEDIATE - 0.01, 0, {}, true)).toBe(true);
    expect(shouldRestart(IMMEDIATE - 0.01, 0, {}, true)).toBe(false);
  });

  it('follows a clock that went back a second or more at once: that is a seek', () => {
    expect(shouldRestart(-JUMP_BACK - 0.01, 0, {})).toBe(true);
  });

  it('replays late news: a clock that falls behind and catches up no longer bounces the stems', () => {
    // a clock lagging by up to 0.9 s in bursts, checked every 500 ms
    const drifts = [0, -0.05, -0.2, -0.6, 0.02, -0.3, -0.9, 0.01, -0.4, -0.7, 0.03, -0.25, 0];
    const memo = {};
    let restarts = 0, old = 0;
    drifts.forEach((d, i) => { if (shouldRestart(d, i * 0.5, memo)) restarts += 1; if (Math.abs(d) > 0.15) old += 1; });
    expect(old).toBe(7); // the old rule: a restart each time
    expect(restarts).toBe(0);
  });
});
