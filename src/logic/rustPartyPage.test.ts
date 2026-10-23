import { describe, test, expect, beforeEach, vi } from 'vitest';
import { handOverToRustPage, rememberRustPartyPage, rustPartyUrl, wantsRustPartyPage } from './rustPartyPage';
import { clearPartySession, loadPartySession, savePartySession } from './partySession';

// vitest runs in node: minimal storages and a location that records where it went
const stores = { local: new Map<string, string>(), session: new Map<string, string>() };
const storage = (m: Map<string, string>) => ({
  getItem: (k: string) => m.get(k) ?? null,
  setItem: (k: string, v: unknown) => { m.set(k, String(v)); },
  removeItem: (k: string) => { m.delete(k); },
});
vi.stubGlobal('localStorage', storage(stores.local));
vi.stubGlobal('sessionStorage', storage(stores.session));
const replaced: string[] = [];
vi.stubGlobal('window', { location: { replace: (url: string) => { replaced.push(url); } } });

describe('rustPartyPage', () => {
  beforeEach(() => { stores.local.clear(); clearPartySession(); replaced.length = 0; });

  test('off until the account turns it on, and off again once it says so (or signs out)', () => {
    expect(wantsRustPartyPage()).toBe(false);
    rememberRustPartyPage(true);
    expect(wantsRustPartyPage()).toBe(true);
    rememberRustPartyPage(false);
    expect(wantsRustPartyPage()).toBe(false);
  });

  test("the Rust page's address keeps the song, the query and the hash", () => {
    expect(rustPartyUrl({ pathname: '/sing/74wbajT93yL', search: '?t=42', hash: '#x' })).toBe('/rust/sing/74wbajT93yL?t=42#x');
    expect(rustPartyUrl({ pathname: '/sing/none', search: '', hash: '' })).toBe('/rust/sing/none');
  });

  test('a party the join page handed over in the router state goes along in the party session', () => {
    handOverToRustPage({ pathname: '/sing/none', search: '', hash: '', state: { partyId: 'AB12', currentUserName: 'Mia', isHost: false } });
    expect(loadPartySession()).toEqual({ partyId: 'AB12', username: 'Mia', isHost: false });
    expect(replaced).toEqual(['/rust/sing/none']);
  });

  test("without one, the tab's party session is left as it is", () => {
    savePartySession({ partyId: 'CD34', username: 'Leo', isHost: true });
    handOverToRustPage({ pathname: '/sing/74wbajT93yL', search: '', hash: '', state: null });
    expect(loadPartySession()).toEqual({ partyId: 'CD34', username: 'Leo', isHost: true });
    expect(replaced).toEqual(['/rust/sing/74wbajT93yL']);
  });
});
