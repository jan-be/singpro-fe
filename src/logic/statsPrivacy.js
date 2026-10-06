/**
 * Who sees an account's stats (backend statsPrivacy.js): 'public', what every
 * account starts with, or 'private', the owner alone. The signed-in user's
 * own choice comes with /auth/me as `statsVisibility` and is changed with
 * PATCH /auth/me. Someone else's private profile arrives from GET
 * /users/:name as { user, private: true, relation } with no stats in it, a
 * private friend in the friends list as { private: true } without numbers.
 */
export const STATS_VISIBILITY = ['public', 'private'];

/** The signed-in user's choice; missing (a server from before the setting) is public, as it always was. */
export const statsVisibilityOf = (user) => (STATS_VISIBILITY.includes(user?.statsVisibility) ? user.statsVisibility : 'public');

/** Someone else's profile that keeps its stats private: the page shows the name and picture, and says why. */
export const isPrivateProfile = (profile) => Boolean(profile?.private) && !profile.isMe;
