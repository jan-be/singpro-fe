import { describe, it, expect } from 'vitest';
import { STATS_VISIBILITY, statsVisibilityOf, isPrivateProfile } from './statsPrivacy.js';

describe('statsVisibilityOf', () => {
  it('reads the choice from the signed-in user', () => {
    expect(STATS_VISIBILITY).toEqual(['public', 'private']);
    expect(statsVisibilityOf({ statsVisibility: 'private' })).toBe('private');
    expect(statsVisibilityOf({ statsVisibility: 'public' })).toBe('public');
  });

  it('is public when the server says nothing or something it does not know', () => {
    expect(statsVisibilityOf({})).toBe('public');
    expect(statsVisibilityOf(null)).toBe('public');
    expect(statsVisibilityOf({ statsVisibility: 'friends' })).toBe('public');
  });
});

describe('isPrivateProfile', () => {
  it("is someone else's profile that came without stats", () => {
    expect(isPrivateProfile({ user: { username: 'Bob' }, private: true, relation: null, isMe: false })).toBe(true);
  });

  it('is never your own, nor a public one', () => {
    expect(isPrivateProfile({ private: true, isMe: true })).toBe(false);
    expect(isPrivateProfile({ user: { username: 'Bob' }, stats: { songsSung: 3 }, isMe: false })).toBe(false);
    expect(isPrivateProfile(null)).toBe(false);
  });
});
