import { describe, it, expect, beforeEach } from 'vitest';
import { searchSession, currentSearch, endSearch, trackEvent } from './track.js';

describe('search sessions', () => {
  beforeEach(() => { endSearch('entry'); endSearch('queue'); });

  it('starts once per scope and keeps the id until ended', () => {
    expect(currentSearch('entry')).toBe(null);
    const a = searchSession('entry');
    expect(searchSession('entry')).toBe(a);
    expect(currentSearch('entry')).toBe(a);
    expect(a.source).toBe('entry');
    endSearch('entry');
    expect(currentSearch('entry')).toBe(null);
    expect(searchSession('entry')).not.toBe(a);
  });

  it('keeps the entry and queue scopes apart and remembers where a session came from', () => {
    const entry = searchSession('entry', 'youtube');
    const queue = searchSession('queue');
    expect(entry.id).not.toBe(queue.id);
    expect(entry.source).toBe('youtube');
    expect(queue.source).toBe('queue');
    endSearch('queue');
    expect(currentSearch('entry')).toBe(entry);
  });

  it('never throws where there is no browser', () => {
    expect(() => trackEvent('search', { q: 'x' })).not.toThrow();
  });
});
