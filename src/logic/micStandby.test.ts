import { describe, it, expect } from 'vitest';
import { micAction, micPermission, MIC_IDLE_GRACE_MS, MIC_HIDDEN_GRACE_MS } from './micStandby';

const s = (over = {}) => ({ open: true, opening: false, needed: false, hidden: false, idleMs: 0, ...over });

describe('micAction', () => {
  it('keeps an open microphone while it is needed, in a background tab too', () => {
    expect(micAction(s({ needed: true, idleMs: 1e9 }))).toBeNull();
    expect(micAction(s({ needed: true, hidden: true, idleMs: 1e9 }))).toBeNull();
  });

  it('closes it after the grace with nothing playing, sooner in a background tab', () => {
    expect(micAction(s({ idleMs: MIC_IDLE_GRACE_MS - 1 }))).toBeNull();
    expect(micAction(s({ idleMs: MIC_IDLE_GRACE_MS }))).toBe('close');
    expect(micAction(s({ hidden: true, idleMs: MIC_HIDDEN_GRACE_MS - 1 }))).toBeNull();
    expect(micAction(s({ hidden: true, idleMs: MIC_HIDDEN_GRACE_MS }))).toBe('close');
  });

  it('opens a closed one when a song plays in a tab being looked at', () => {
    expect(micAction(s({ open: false, needed: true }))).toBe('open');
    expect(micAction(s({ open: false, needed: true, hidden: true }))).toBeNull();
    expect(micAction(s({ open: false, needed: false }))).toBeNull();
  });

  it('does not open it twice', () => {
    expect(micAction(s({ open: false, opening: true, needed: true }))).toBeNull();
  });
});

describe('micPermission', () => {
  it('reads the state, or null where the browser cannot say', async () => {
    expect(await micPermission({ query: async () => ({ state: 'granted' }) })).toBe('granted');
    expect(await micPermission({ query: async () => { throw new TypeError('microphone is not a permission name'); } })).toBeNull();
    expect(await micPermission(undefined)).toBeNull();
  });
});
