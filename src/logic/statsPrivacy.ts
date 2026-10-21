/**
 * Who sees an account's stats (backend statsPrivacy.ts): 'public', what every
 * account starts with, 'friends', the owner and their friends, or 'private',
 * the owner alone. The signed-in user's
 * own choice comes with /auth/me as `statsVisibility` and is changed with
 * PATCH /auth/me. Someone else's private profile arrives from GET
 * /users/:name as { user, private: true, relation } with no stats in it (and
 * friendsOnly: true when friends would see them), a private friend in the
 * friends list as { private: true } without numbers.
 */
export const STATS_VISIBILITY: Visibility[] = ['public', 'friends', 'private'];

/** Who sees a part of a profile */
export type Visibility = 'public' | 'friends' | 'private';
/** The parts of a profile with a setting of their own */
export type PrivacySection = 'stats' | 'best' | 'achievements' | 'recent' | 'recordings';
/** Each part's setting, as /auth/me sends them in `privacy` */
export type PrivacySettings = Record<PrivacySection, Visibility>;

/**
 * What the settings are read from: the signed-in user (authApi Me), or anything shaped like it, with values not
 * checked yet (a server may send one this page does not know)
 */
export interface PrivacySource {
  privacy?: Partial<Record<PrivacySection, string>> | null;
  statsVisibility?: string | null;
}

/** What a new account starts with, part by part */
const INITIAL: PrivacySettings = { stats: 'public', best: 'public', achievements: 'public', recent: 'friends', recordings: 'private' };

/**
 * The parts of a profile with a setting of their own (backend
 * statsPrivacy.ts), in the order the privacy panel lists them, and what a
 * new account starts with. 'stats' is the numbers and leaderboards.
 */
export const PRIVACY_SECTIONS: { key: PrivacySection; initial: Visibility }[] = (['stats', 'best', 'achievements', 'recent', 'recordings'] as const)
  .map(key => ({ key, initial: INITIAL[key] }));

/** A value the server sent is one this page knows */
const isVisibility = (v: unknown): v is Visibility => STATS_VISIBILITY.some(s => s === v);

/** The signed-in user's settings, { stats, best, achievements, recent, recordings }, from /auth/me's `privacy` */
export const privacyOf = (user: PrivacySource | null): PrivacySettings => {
  const settings = { ...INITIAL };
  for (const { key } of PRIVACY_SECTIONS) {
    const v = user?.privacy?.[key] ?? (key === 'stats' ? user?.statsVisibility : undefined);
    if (isVisibility(v)) settings[key] = v;
  }
  return settings;
};

/** The signed-in user's choice; missing (a server from before the setting) is public, as it always was. */
export const statsVisibilityOf = (user: PrivacySource | null): Visibility => {
  const v = user?.statsVisibility;
  return isVisibility(v) ? v : 'public';
};

/** Someone else's profile that keeps its stats private: the page shows the name and picture, and says why. */
export const isPrivateProfile = <P extends { private?: boolean; isMe?: boolean }>(profile: P | null): profile is Extract<P, { private: true }> => !!profile?.private && !profile.isMe;
