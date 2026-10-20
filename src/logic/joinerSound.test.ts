import { describe, it, expect } from 'vitest';
import { joinerSoundDefault, loadJoinerSound, saveJoinerSound } from './joinerSound';

const memoryStorage = () => {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
};

describe('joinerSound', () => {
  it('is on only for the copied party link', () => {
    expect(joinerSoundDefault('link')).toBe(true);
    for (const arrival of ['qr', 'join', 'invite', null, undefined]) expect(joinerSoundDefault(arrival)).toBe(false);
  });

  it('keeps a choice for the same party and not for the next one', () => {
    const s = memoryStorage();
    expect(loadJoinerSound('ABCD', 'qr', s)).toBe(false);
    saveJoinerSound('ABCD', true, s);
    expect(loadJoinerSound('ABCD', 'qr', s)).toBe(true);
    expect(loadJoinerSound('WXYZ', 'qr', s)).toBe(false);
    saveJoinerSound('WXYZ', false, s);
    expect(loadJoinerSound('WXYZ', 'link', s)).toBe(false);
  });

  it('falls back to the default without storage', () => {
    const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    saveJoinerSound('ABCD', true, broken);
    expect(loadJoinerSound('ABCD', 'link', broken)).toBe(true);
    expect(loadJoinerSound('ABCD', 'qr', broken)).toBe(false);
  });
});
