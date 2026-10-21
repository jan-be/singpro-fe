import { describe, test, expect, beforeEach } from 'vitest';
import { savePartySession, loadPartySession, renamePartySession, clearPartySession } from './partySession';

// vitest runs in node: a minimal sessionStorage stand-in
const items = new Map<string, string>();
globalThis.sessionStorage = {
  getItem: (k: string) => (items.has(k) ? items.get(k) : null),
  setItem: (k: string, v: unknown) => { items.set(k, String(v)); },
  removeItem: (k: string) => { items.delete(k); },
} as unknown as Storage;

describe('partySession', () => {
  beforeEach(() => clearPartySession());

  test('a rename carries the party over to the new name', () => {
    savePartySession({ partyId: 'AB12', username: 'Ann', isHost: true });
    renamePartySession('Ann', 'Anna');
    expect(loadPartySession()).toEqual({ partyId: 'AB12', username: 'Anna', isHost: true });
  });

  test('a party joined under another name, or none, is left alone', () => {
    renamePartySession('Ann', 'Anna');
    expect(loadPartySession()).toBe(null);
    savePartySession({ partyId: 'AB12', username: 'Guesty', isHost: false });
    renamePartySession('Ann', 'Anna');
    expect(loadPartySession()!.username).toBe('Guesty');
  });
});
