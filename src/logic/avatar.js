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

/** Whose picture and which: { userId, version } from its path, or null. */
export function parseAvatarPath(path) {
  const m = typeof path === 'string' ? path.match(/^\/users\/(\d+)\/avatar\?v=(\d+)$/) : null;
  return m ? { userId: Number(m[1]), version: Number(m[2]) } : null;
}

/** The picture's URL for an <img> or a canvas, or null (no picture, or not one of ours). */
export const avatarSrc = (path) => (typeof path === 'string' && AVATAR_PATH.test(path) ? `${apiUrl}${path}` : null);

let segmenter;
/**
 * The first character of a name as a person reads it: a whole emoji (👩‍🎤,
 * flags, skin tones), a CJK character, a letter with its accents; upper-cased
 * where that stays one character ('ß' stays 'ß', not 'SS'). '?' for nothing.
 */
export function avatarInitial(name) {
  const g = graphemes(name);
  return g.length ? changeCase(g[0], 'toUpperCase') : '?';
}

const graphemeCache = new Map();
/** A name's characters as a person reads them (see avatarInitial); cached, as the highway asks every frame. */
export function graphemes(name) {
  const s = String(name ?? '').trim();
  let g = graphemeCache.get(s);
  if (!g) {
    try {
      segmenter ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' });
      g = Array.from(segmenter.segment(s), x => x.segment);
    } catch { g = Array.from(s); } // no Intl.Segmenter (old browsers): whole code points at least
    if (graphemeCache.size > 500) graphemeCache.clear();
    graphemeCache.set(s, g);
  }
  return g;
}

/** Upper or lower case where that stays one character ('ß' stays 'ß', not 'SS'). */
function changeCase(ch, how) {
  const c = ch[how]();
  return Array.from(c).length === Array.from(ch).length ? c : ch;
}

/**
 * Two letters for players who would otherwise look the same: on screen
 * together, without a picture, with the same first letter and the same
 * colour (Bea and Ben, both orange). Each gets its first letter and the first
 * one after it that tells it apart from the others (Bea "Ba", Ben "Bn"; Bob
 * next to Ben "Bo" / "Be"), compared without case. Returns a Map of username
 * -> letters for those players only, or null when nobody clashes (the usual
 * case: nothing is allocated past the grouping).
 *
 *   names: usernames shown; hueOf(name): their colour; hasPicture(name)
 */
export function tieLetters(names, hueOf, hasPicture) {
  let groups = null;
  for (const name of names) {
    if (hasPicture(name)) continue;
    const key = `${avatarInitial(name)}|${hueOf(name)}`;
    groups ??= new Map();
    const group = groups.get(key);
    if (!group) groups.set(key, [name]);
    else if (!group.includes(name)) group.push(name);
  }
  let out = null;
  for (const group of groups?.values() ?? []) {
    if (group.length < 2) continue;
    const lower = group.map(n => graphemes(n).map(ch => ch.toLowerCase()));
    group.forEach((name, i) => {
      const own = lower[i];
      let k = 1;
      while (k < own.length && lower.some((other, j) => j !== i && other[k] === own[k])) k++;
      if (k >= own.length) k = 1; // nothing sets it apart: its second letter, if it has one
      const second = graphemes(name)[k];
      out ??= new Map();
      out.set(name, avatarInitial(name) + (second ? changeCase(second, 'toLowerCase') : ''));
    });
  }
  return out;
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
