// The party page in Rust (experimental: the account's switch in Settings → Experimental). It is
// the singspree-egui app, built into public/rust/ (its tools/into-web-app.sh) and served under
// /rust/ (nginx.conf). A song's page hands over to it there when the switch is on.
//
// The switch is the account's (users.rust_party_page, off for everyone until they turn it on);
// this browser keeps a copy so the hand-over needs no answer from /auth/me first.
import type { PartySession } from './partySession';
import { savePartySession } from './partySession';

const KEY = 'singspree_rust_party_page';

/** Where the Rust page is served: its paths are the web app's below this */
export const RUST_BASE = '/rust';

/** The account's switch as this browser last saw it (signed out: off) */
export function rememberRustPartyPage(on: boolean) {
  try {
    if (on) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
  } catch { /* no storage: the web app's page, as without the switch */ }
}

export function wantsRustPartyPage(): boolean {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}

/** The Rust page's address for a web app address: /sing/x?t=12 → /rust/sing/x?t=12 */
export function rustPartyUrl(location: { pathname: string; search: string; hash: string }): string {
  return `${RUST_BASE}${location.pathname}${location.search}${location.hash}`;
}

/**
 * Goes to the Rust page in place of this one. The join page hands its party over in the
 * router's state, which a page load does not keep, so it goes into the tab's party session
 * first, where the Rust page (like a reload of this one) finds it.
 */
export function handOverToRustPage(location: { pathname: string; search: string; hash: string; state?: unknown }) {
  const s = location.state as { partyId?: string; currentUserName?: string; isHost?: boolean } | null | undefined;
  if (s?.partyId && s.currentUserName) {
    const session: PartySession = { partyId: s.partyId, username: s.currentUserName, isHost: s.isHost ?? false };
    try { savePartySession(session); } catch { /* no storage: the Rust page starts on its own */ }
  }
  window.location.replace(rustPartyUrl(location));
}
