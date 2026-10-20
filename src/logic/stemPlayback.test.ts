import { describe, it, expect } from 'vitest';
import { stemPlayback } from './stemPlayback';

const memoryStorage = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};

describe('stemPlayback', () => {
  it('decodes whole on Apple WebKit and streams everywhere else', () => {
    expect(stemPlayback({ vendor: 'Apple Computer, Inc.', search: '', storage: memoryStorage() })).toBe('memory');
    expect(stemPlayback({ vendor: 'Google Inc.', search: '', storage: memoryStorage() })).toBe('stream'); // Chrome, Android WebViews
    expect(stemPlayback({ vendor: '', search: '', storage: memoryStorage() })).toBe('stream'); // Firefox
  });

  it('takes ?stems= as an override for this browser, and ?stems=auto hands it back', () => {
    const storage = memoryStorage();
    expect(stemPlayback({ vendor: 'Google Inc.', search: '?stems=memory', storage })).toBe('memory');
    expect(stemPlayback({ vendor: 'Google Inc.', search: '', storage })).toBe('memory'); // remembered
    expect(stemPlayback({ vendor: 'Google Inc.', search: '?stems=auto', storage })).toBe('stream');
    expect(stemPlayback({ vendor: 'Apple Computer, Inc.', search: '?stems=stream', storage })).toBe('stream');
  });

  it('works without storage', () => {
    const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() {} };
    expect(stemPlayback({ vendor: 'Google Inc.', search: '?stems=memory', storage: broken })).toBe('stream');
  });
});
