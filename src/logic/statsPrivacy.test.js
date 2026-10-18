import { describe, it, expect } from 'vitest';
import { PRIVACY_SECTIONS, STATS_VISIBILITY, privacyOf, statsVisibilityOf, isPrivateProfile } from './statsPrivacy.js';

describe('statsVisibilityOf', () => {
  it('reads the choice from the signed-in user', () => {
    expect(STATS_VISIBILITY).toEqual(['public', 'friends', 'private']);
    expect(statsVisibilityOf({ statsVisibility: 'friends' })).toBe('friends');
    expect(statsVisibilityOf({ statsVisibility: 'private' })).toBe('private');
    expect(statsVisibilityOf({ statsVisibility: 'public' })).toBe('public');
  });

  it('is public when the server says nothing or something it does not know', () => {
    expect(statsVisibilityOf({})).toBe('public');
    expect(statsVisibilityOf(null)).toBe('public');
    expect(statsVisibilityOf({ statsVisibility: 'everyone' })).toBe('public');
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

describe('privacyOf', () => {
  it('reads each part from /auth/me, and starts a missing one where a new account starts', () => {
    expect(PRIVACY_SECTIONS.map(s => s.key)).toEqual(['stats', 'best', 'achievements', 'recent', 'recordings']);
    expect(privacyOf(null)).toEqual({ stats: 'public', best: 'public', achievements: 'public', recent: 'friends', recordings: 'private' });
    expect(privacyOf({ privacy: { best: 'friends', recordings: 'public', recent: 'everyone' } }))
      .toEqual({ stats: 'public', best: 'friends', achievements: 'public', recent: 'friends', recordings: 'public' });
  });

  it('takes the numbers from statsVisibility when a server from before the parts sends only that', () => {
    expect(privacyOf({ statsVisibility: 'private' }).stats).toBe('private');
    expect(privacyOf({ statsVisibility: 'private', privacy: { stats: 'friends' } }).stats).toBe('friends');
  });
});
