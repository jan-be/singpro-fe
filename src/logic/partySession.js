// The party this tab is in, kept in sessionStorage so a reload or a trip to
// the menu (or the profile page) does not lose the partyId, the name it plays
// under, or whether it hosts.
const SESSION_KEY = 'singpro_party';

export function savePartySession({ partyId, username, isHost }) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({ partyId, username, isHost }));
}

export function loadPartySession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function clearPartySession() {
  sessionStorage.removeItem(SESSION_KEY);
}

/**
 * The account went from `from` to `to` (the profile page): a party this tab
 * plays in under the old name comes back under the new one, which the server
 * gave its seat (websocketHandler.accountRenamed). Under the old one it would
 * be a new seat, and a host a joiner of their own party.
 */
export function renamePartySession(from, to) {
  try {
    const s = loadPartySession();
    if (s?.username === from) savePartySession({ ...s, username: to });
  } catch { /* no storage: nothing kept */ }
}
