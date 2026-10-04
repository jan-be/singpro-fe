import { apiUrl } from '../GlobalConsts';

/**
 * Profile pictures (backend avatars.js). The server hands out a picture as
 * an API path with its version, '/users/12/avatar?v=1759600000000', on the
 * signed-in user, in friends lists and on every signed-in player in a party;
 * no picture is null. The picture at a path never changes, so the browser
 * keeps it for good. Without a picture the avatar is the name's first letter
 * in the player's colour.
 */

const AVATAR_PATH = /^\/users\/\d+\/avatar(\?v=\d+)?$/;

/** The picture's URL for an <img> or a canvas, or null (no picture, or not one of ours). */
export const avatarSrc = (path) => (typeof path === 'string' && AVATAR_PATH.test(path) ? `${apiUrl}${path}` : null);

let segmenter;
/**
 * The first character of a name as a person reads it: a whole emoji (👩‍🎤,
 * flags, skin tones), a CJK character, a letter with its accents; upper-cased
 * where that stays one character ('ß' stays 'ß', not 'SS'). '?' for nothing.
 */
export function avatarInitial(name) {
  const s = String(name ?? '').trim();
  if (!s) return '?';
  let first = null;
  try {
    segmenter ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    first = segmenter.segment(s)[Symbol.iterator]().next().value?.segment ?? null;
  } catch { /* no Intl.Segmenter (old browsers): whole code points at least */ }
  first ??= Array.from(s)[0];
  const upper = first.toUpperCase();
  return Array.from(upper).length === Array.from(first).length ? upper : first;
}

/**
 * What a list of players says about their pictures: username -> path, or null
 * for a player without one (party:state, party:player_joined, the board, the
 * score screen; a guest's entry has no `avatar` at all). Returns `prev` when
 * nothing changed, so React state set from it does not re-render.
 */
export function learnAvatars(prev, players) {
  let next = prev;
  for (const p of players ?? []) {
    if (!p?.username) continue;
    const avatar = typeof p.avatar === 'string' ? p.avatar : null;
    if ((prev[p.username] ?? null) !== avatar || !(p.username in prev)) {
      if (next === prev) next = { ...prev };
      next[p.username] = avatar;
    }
  }
  return next;
}
