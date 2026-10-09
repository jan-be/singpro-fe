// Who runs the party besides the host (co-hosts, with the host's rights) and
// whether new people may join by the QR code or the link: the server's
// party:settings, also carried by party:state. A server from before co-hosts
// sends neither, and its party is then shown as always: open, no co-hosts,
// no controls for them (`known` false).

export const NO_SETTINGS = Object.freeze({ known: false, cohosts: [], joiningOpen: true, autoSkip: null });

/** The settings in a party:state or party:settings message, or `prev` when it has none. */
export function readSettings(prev, data) {
  if (!data || typeof data.joiningOpen !== 'boolean') return prev;
  return {
    known: true,
    cohosts: Array.isArray(data.cohosts) ? data.cohosts.filter(n => typeof n === 'string') : [],
    joiningOpen: data.joiningOpen,
    autoSkip: typeof data.autoSkip === 'boolean' ? data.autoSkip : null,
  };
}

/** A player renamed (player:renamed): a co-host keeps the role under the new name. */
export function renameInSettings(settings, from, to) {
  if (!settings.cohosts.includes(from)) return settings;
  return { ...settings, cohosts: settings.cohosts.map(n => (n === from ? to : n)) };
}

/**
 * The people of the QR code card, each with a co-host switch: the host first,
 * then you, then everyone else in the order they came; a co-host who is away
 * right now (their phone asleep) stays listed, so the role can be taken back.
 * Another microphone of a page is not a person and is left out.
 * -> [{ name, host, cohost, me, away }]
 */
export function cardPeople({ members = [], cohosts = [], owner = null, extras = new Set(), me = null }) {
  const here = new Set(members);
  const names = [...new Set([...(owner ? [owner] : []), ...(me ? [me] : []), ...members, ...cohosts])]
    .filter(name => !extras.has(name));
  const cohostSet = new Set(cohosts);
  const people = names.map(name => ({
    name,
    host: name === owner,
    cohost: name !== owner && cohostSet.has(name),
    me: name === me,
    away: !here.has(name) && name !== me,
  }));
  // The host and you first; the absent after the present
  const rank = p => (p.host ? 0 : p.me ? 1 : p.away ? 3 : 2);
  return people.map((p, i) => ({ p, i })).sort((a, b) => rank(a.p) - rank(b.p) || a.i - b.i).map(({ p }) => p);
}
