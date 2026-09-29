import { describe, it, expect } from 'vitest';
import {
  ACHIEVEMENT_INFO, achievementInfo, creditLine, fraction, profileList, progressText, mergeEndAchievements, newestNotification, scoreCardChips,
} from './achievements.js';
import en from '../i18n/locales/en.json';

const item = (key, over = {}) => ({ key, goal: 10, unlockedAt: null, ...over });

describe('achievement info', () => {
  it('names a song and credits it; a line from a song credits the song too', () => {
    expect(creditLine(achievementInfo('same_song_5'))).toBe('Rick Astley');
    expect(achievementInfo('stage_3').name).toBe("Three's a Party");
    expect(creditLine(achievementInfo('stage_3'))).toBe('Hotel Room Service – Pitbull');
    expect(achievementInfo('nope')).toBe(null);
    expect(creditLine(null)).toBe('');
  });

  it('every achievement has an icon, a short name, an artist and an English description', () => {
    for (const [key, info] of Object.entries(ACHIEVEMENT_INFO)) {
      expect(info.icon, key).toBeTruthy();
      expect(info.artist, key).toBeTruthy();
      expect(info.name.split(' ').length, key).toBeLessThanOrEqual(6);
      expect(en.achievements.desc[key], key).toBeTruthy();
    }
  });
});

describe('profileList', () => {
  const items = [
    item('songs_1', { goal: 1, unlockedAt: '2026-09-20T20:00:00Z', progress: 1 }),
    item('songs_10', { progress: 4 }),
    item('songs_50', { goal: 50, progress: 4 }),
    item('stars_1', { goal: 3000, progress: 2900 }),
    item('stage_3', { goal: 3, progress: 1 }),
    item('duet_partner', { goal: 1, progress: 0 }),
    item('from_the_future', { unlockedAt: '2026-09-21T20:00:00Z' }),
  ];

  it('folded: what was earned and the three closest, in catalogue order', () => {
    expect(profileList(items).map(i => i.key)).toEqual(['songs_1', 'songs_10', 'stars_1', 'stage_3']);
  });

  it('unfolded: everything this build knows', () => {
    expect(profileList(items, { expanded: true }).map(i => i.key)).toEqual(['songs_1', 'songs_10', 'songs_50', 'stars_1', 'stage_3', 'duet_partner']);
  });

  it('without progress (someone else\'s profile) folded shows only what was earned', () => {
    const visitor = items.map(({ progress, ...rest }) => rest); // eslint-disable-line no-unused-vars
    expect(profileList(visitor).map(i => i.key)).toEqual(['songs_1']);
    expect(profileList(null)).toEqual([]);
  });
});

describe('progress', () => {
  it('fraction: 1 once earned, 0 without progress', () => {
    expect(fraction(item('songs_10', { progress: 4 }))).toBe(0.4);
    expect(fraction(item('songs_10', { progress: 40 }))).toBe(1);
    expect(fraction(item('songs_10', { unlockedAt: '2026-09-20T20:00:00Z' }))).toBe(1);
    expect(fraction(item('songs_10'))).toBe(0);
  });

  it('text in the achievement\'s unit: counts, points, hours', () => {
    expect(progressText(item('songs_10', { progress: 4 }))).toBe('4 / 10');
    expect(progressText(item('stars_2', { goal: 6000, progress: 4200 }))).toBe('4,200 / 6,000');
    expect(progressText(item('stars_2', { goal: 6000, progress: 4200 }), 'de')).toBe('4.200 / 6.000');
    expect(progressText(item('hours_1', { goal: 3600, progress: 1500 }))).toBe('0.4 / 1 hr');
    expect(progressText(item('hours_1', { goal: 3600, progress: 3599 }))).toBe('0.9 / 1 hr');
    expect(progressText(item('hours_10', { goal: 36000, progress: 36000, unlockedAt: '2026-09-20T20:00:00Z' }))).toBe('10 / 10 hr');
  });
});

describe('mergeEndAchievements', () => {
  const endScores = [{ username: 'Jan', score: 9000 }, { username: 'Kim', score: 5000 }];

  it('puts each singer\'s new achievements on their card', () => {
    const merged = mergeEndAchievements(endScores, [{ username: 'Kim', keys: ['stage_3', 'songs_1'] }]);
    expect(merged[0]).toBe(endScores[0]);
    expect(merged[1]).toEqual({ username: 'Kim', score: 5000, achievements: ['stage_3', 'songs_1'] });
  });

  it('adds to what is there, once each, and drops keys this build does not know', () => {
    const once = mergeEndAchievements(endScores, [{ username: 'Jan', keys: ['songs_1'] }]);
    const twice = mergeEndAchievements(once, [{ username: 'Jan', keys: ['songs_1', 'stars_3', 'from_the_future'] }]);
    expect(twice[0].achievements).toEqual(['songs_1', 'stars_3']);
    expect(mergeEndAchievements(endScores, [])).toBe(endScores);
    expect(mergeEndAchievements(endScores, undefined)).toBe(endScores);
  });
});

describe('scoreCardChips', () => {
  const firstSong = ['songs_1', 'stars_1', 'stars_2', 'stars_3', 'score_9500', 'stage_3'];

  it('your own card names everything you earned', () => {
    expect(scoreCardChips(firstSong, { mine: true })).toEqual({ shown: firstSong, more: 0 });
  });

  it('someone else\'s names the last two in catalogue order and counts the rest', () => {
    expect(scoreCardChips(firstSong)).toEqual({ shown: ['score_9500', 'stage_3'], more: 4 });
    expect(scoreCardChips(['duet_partner'])).toEqual({ shown: ['duet_partner'], more: 0 });
    expect(scoreCardChips(['nope', 'songs_1'])).toEqual({ shown: ['songs_1'], more: 0 });
    expect(scoreCardChips(undefined)).toEqual({ shown: [], more: 0 });
  });
});

describe('newestNotification', () => {
  it('the newest of the newest request and the newest achievement', () => {
    expect(newestNotification({ friendRequests: [{ createdAt: '2026-09-25T20:00:00.000Z' }], achievements: [{ unlockedAt: '2026-09-26T08:00:00.000Z' }] })).toBe('2026-09-26T08:00:00.000Z');
    expect(newestNotification({ friendRequests: [{ createdAt: '2026-09-25T20:00:00.000Z' }], achievements: [] })).toBe('2026-09-25T20:00:00.000Z');
    expect(newestNotification({ friendRequests: [], achievements: [{ unlockedAt: '2026-09-26T08:00:00.000Z' }] })).toBe('2026-09-26T08:00:00.000Z');
    expect(newestNotification({ friendRequests: [] })).toBe(null);
    expect(newestNotification(null)).toBe(null);
  });
});
