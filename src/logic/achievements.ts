/**
 * Achievements as the pages show them. The backend (singspree-be
 * src/achievements.ts) decides who earned what and sends the catalogue in
 * order as [{ key, goal, unlockedAt, progress? }] (progress only on your own
 * profile); this adds each one's name, a famous line or hook of a song
 * (a few words, never a whole verse) credited underneath, and an icon. Names and credits are titles and stay as they are
 * in every language; what it takes is translated (achievements.desc.<key>).
 *
 * A key the backend knows and this file does not (a newer backend) is left
 * out rather than shown half-empty.
 */
/** An achievement as the backend sends it (GET /users/:username), `progress` only on your own profile */
export interface AchievementItem {
  key: string;
  goal: number;
  unlockedAt: string | null;
  progress?: number;
}

/** What this file adds to a key: `kind` is the unit its progress counts in */
export interface AchievementInfo {
  key: string;
  kind: 'count' | 'score' | 'seconds';
  icon: string;
  name: string;
  song?: string;
  artist: string;
}

/** An achievement on the profile: with its info */
export type ProfileAchievement = AchievementItem & { info: AchievementInfo };

/** One singer's newly earned keys on the score screen (party:achievements) */
export interface EarnedAchievements {
  username: string;
  keys?: string[];
}

export const ACHIEVEMENT_INFO: Record<string, Omit<AchievementInfo, 'key' | 'kind'> & { kind?: AchievementInfo['kind'] }> = {
  songs_1: { icon: '🍝', name: "Mom's Spaghetti", song: 'Lose Yourself', artist: 'Eminem' },
  songs_10: { icon: '🎶', name: 'Hit Me Baby One More Time', song: '...Baby One More Time', artist: 'Britney Spears' },
  songs_50: { icon: '🙏', name: "Whoa, We're Halfway There", song: "Livin' on a Prayer", artist: 'Bon Jovi' },
  songs_100: { icon: '🏆', name: "I'm Still Standing", artist: 'Elton John' },
  stars_1: { icon: '🎆', name: "Baby, You're a Firework", song: 'Firework', artist: 'Katy Perry', kind: 'score' },
  stars_2: { icon: '💎', name: 'Shine Bright Like a Diamond', song: 'Diamonds', artist: 'Rihanna', kind: 'score' },
  stars_3: { icon: '🌟', name: "Hey Now, You're an All Star", song: 'All Star', artist: 'Smash Mouth', kind: 'score' },
  stars_4: { icon: '✨', name: 'A Sky Full of Stars', artist: 'Coldplay', kind: 'score' },
  stars_5: { icon: '🌠', name: "I'm a Shooting Star", song: "Don't Stop Me Now", artist: 'Queen', kind: 'score' },
  four_star_songs_10: { icon: '💫', name: 'Simply the Best', song: 'The Best', artist: 'Tina Turner' },
  score_9500: { icon: '🤯', name: 'Is This the Real Life?', song: 'Bohemian Rhapsody', artist: 'Queen', kind: 'score' },
  improve_1000: { icon: '📈', name: "What Doesn't Kill You", song: "Stronger (What Doesn't Kill You)", artist: 'Kelly Clarkson', kind: 'score' },
  hours_1: { icon: '⏰', name: 'Tick Tock on the Clock', song: 'TiK ToK', artist: 'Kesha', kind: 'seconds' },
  hours_10: { icon: '⏳', name: 'The Time of My Life', song: "(I've Had) The Time of My Life", artist: 'Bill Medley & Jennifer Warnes', kind: 'seconds' },
  stage_3: { icon: '🎉', name: "Three's a Party", song: 'Hotel Room Service', artist: 'Pitbull' },
  stage_5: { icon: '🙌', name: 'Everybody Dance Now', song: 'Gonna Make You Sweat', artist: 'C+C Music Factory' },
  duet_partner: { icon: '💞', name: 'I Got You Babe', artist: 'Sonny & Cher' },
  mates_10: { icon: '🤝', name: 'We Are Family', artist: 'Sister Sledge' },
  party_songs_10: { icon: '🌙', name: "Tonight's Gonna Be a Good Night", song: 'I Gotta Feeling', artist: 'The Black Eyed Peas' },
  same_song_5: { icon: '🔁', name: 'Never Gonna Give You Up', artist: 'Rick Astley' },
  artists_10: { icon: '🎭', name: 'Ch-Ch-Ch-Changes', song: 'Changes', artist: 'David Bowie' },
  languages_3: { icon: '🌍', name: 'Voulez-Vous', artist: 'ABBA' },
  days_8: { icon: '📅', name: 'Eight Days a Week', artist: 'The Beatles' },
};

/** Name, credit and icon of a key, or null for one this build does not know. */
export function achievementInfo(key: string): AchievementInfo | null {
  const info = ACHIEVEMENT_INFO[key];
  return info ? { key, kind: 'count', ...info } : null;
}

/** "Hotel Room Service – Pitbull" when the name is a line from the song, else just the artist. */
export function creditLine(info: AchievementInfo | null | undefined) {
  if (!info) return '';
  return info.song && info.song !== info.name ? `${info.song} – ${info.artist}` : info.artist;
}

/** How far along, 0..1 (1 once earned). */
export function fraction(item: Pick<AchievementItem, 'unlockedAt' | 'goal' | 'progress'>) {
  if (item.unlockedAt) return 1;
  if (!(item.goal > 0) || !(item.progress! > 0)) return 0; // (no progress: undefined > 0 is false)
  return Math.min(1, item.progress! / item.goal);
}

/**
 * The profile's list: known keys only, with their info, in catalogue order.
 * Folded, it shows what was earned plus the few closest to being earned
 * (only where progress is known, i.e. on your own profile).
 */
export function profileList(items: AchievementItem[] | null | undefined, { expanded = false, nextUp = 3 } = {}) {
  const known = (items ?? []).map(item => ({ ...item, info: achievementInfo(item.key) })).filter(item => item.info) as ProfileAchievement[];
  if (expanded) return known;
  const closest = new Set(known
    .filter(item => !item.unlockedAt && item.progress! > 0) // (undefined > 0 is false)
    .sort((a, b) => fraction(b) - fraction(a))
    .slice(0, nextUp)
    .map(item => item.key));
  return known.filter(item => item.unlockedAt || closest.has(item.key));
}

const number = (lang: string, options: Intl.NumberFormatOptions = {}) => {
  try { return new Intl.NumberFormat(lang, options); } catch { return new Intl.NumberFormat('en', options); }
};

/**
 * "4 / 10", "4,200 / 6,000", "0.4 / 1 hr": progress and goal in the
 * achievement's own unit (time is counted in seconds and shown in hours).
 */
export function progressText(item: AchievementItem, lang = 'en') {
  const info = achievementInfo(item.key);
  const done = item.unlockedAt ? item.goal : Math.min(item.progress ?? 0, item.goal);
  if (info?.kind === 'seconds') {
    const hours = (s: number) => Math.floor((s / 3600) * 10) / 10; // never rounds up to a goal not reached
    let unit: string;
    try { unit = number(lang, { style: 'unit', unit: 'hour', unitDisplay: 'short', maximumFractionDigits: 1 }).format(hours(item.goal)); }
    catch { unit = `${hours(item.goal)} h`; }
    return `${number(lang, { maximumFractionDigits: 1 }).format(hours(done))} / ${unit}`;
  }
  const fmt = number(lang);
  return `${fmt.format(done)} / ${fmt.format(item.goal)}`;
}

/**
 * party:achievements onto the score screen: each singer's card gets the keys
 * they just earned (a second message for the same singer adds to them).
 */
export function mergeEndAchievements<S extends { username: string; achievements?: string[] }>(endScores: S[], players: EarnedAchievements[] | null | undefined): (S & { achievements?: string[] })[] {
  if (!players?.length) return endScores;
  const byName = new Map<string, string[]>();
  for (const p of players) byName.set(p.username, [...(byName.get(p.username) ?? []), ...(p.keys ?? [])]);
  return endScores.map(s => {
    const add = byName.get(s.username);
    if (!add) return s;
    const keys = [...new Set([...(s.achievements ?? []), ...add])].filter(k => achievementInfo(k));
    return { ...s, achievements: keys };
  });
}

/**
 * Which of a singer's new achievements their score card names: all of your
 * own; for everyone else the last few in catalogue order (the harder ones,
 * the first song's six at once would fill a phone) and how many more.
 */
export function scoreCardChips(keys: string[] | null | undefined, { mine = false, max = 2 } = {}) {
  const known = (keys ?? []).filter(k => achievementInfo(k));
  const shown = mine ? known : known.slice(-max);
  return { shown, more: known.length - shown.length };
}

/** The newest date the notifications panel shows (a friend request or an achievement), or null. */
export function newestNotification(data: { friendRequests?: { createdAt: string }[]; achievements?: { unlockedAt: string }[] } | null | undefined) {
  const dates = [data?.friendRequests?.[0]?.createdAt, data?.achievements?.[0]?.unlockedAt].filter(Boolean) as string[];
  if (dates.length === 0) return null;
  return dates.reduce((a, b) => (new Date(b).getTime() > new Date(a).getTime() ? b : a));
}
