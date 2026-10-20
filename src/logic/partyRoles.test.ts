import { describe, it, expect } from 'vitest';
import { NO_SETTINGS, readSettings, renameInSettings, cardPeople } from './partyRoles';

describe('readSettings', () => {
  it('takes the settings from party:state and party:settings', () => {
    const s = readSettings(NO_SETTINGS, { cohosts: ['Ann'], joiningOpen: false, autoSkip: true });
    expect(s).toEqual({ known: true, cohosts: ['Ann'], joiningOpen: false, autoSkip: true });
    expect(readSettings(s, { cohosts: [], joiningOpen: true, autoSkip: null })).toEqual({ known: true, cohosts: [], joiningOpen: true, autoSkip: null });
  });

  it('a server from before co-hosts: nothing to show, the party stays open', () => {
    expect(readSettings(NO_SETTINGS, { partyId: 'ABCD', players: [] })).toBe(NO_SETTINGS);
    expect(NO_SETTINGS.joiningOpen).toBe(true);
    expect(NO_SETTINGS.known).toBe(false);
  });

  it('ignores what is not a name or a switch', () => {
    expect(readSettings(NO_SETTINGS, { cohosts: ['Ann', 3, null], joiningOpen: true, autoSkip: 'yes' }))
      .toEqual({ known: true, cohosts: ['Ann'], joiningOpen: true, autoSkip: null });
  });
});

describe('renameInSettings', () => {
  it('a renamed co-host stays one under the new name', () => {
    const s = { known: true, cohosts: ['Ann', 'Bob'], joiningOpen: true, autoSkip: null };
    expect(renameInSettings(s, 'Ann', 'Anna').cohosts).toEqual(['Anna', 'Bob']);
    expect(renameInSettings(s, 'Cat', 'Kat')).toBe(s);
  });
});

describe('cardPeople', () => {
  it('the host first, then you, then the others as they came; microphones are no people', () => {
    const people = cardPeople({
      members: ['Bob', 'Host', 'Mic 2', 'Ann', 'Cat'], cohosts: ['Cat'], owner: 'Host', extras: new Set(['Mic 2']), me: 'Ann',
    });
    expect(people).toEqual([
      { name: 'Host', host: true, cohost: false, me: false, away: false },
      { name: 'Ann', host: false, cohost: false, me: true, away: false },
      { name: 'Bob', host: false, cohost: false, me: false, away: false },
      { name: 'Cat', host: false, cohost: true, me: false, away: false },
    ]);
  });

  it('a co-host who is away stays listed (to take the role back), after those here', () => {
    const people = cardPeople({ members: ['Host', 'Bob'], cohosts: ['Zoe'], owner: 'Host', me: 'Host' });
    expect(people.map(p => [p.name, p.cohost, p.away])).toEqual([['Host', false, false], ['Bob', false, false], ['Zoe', true, true]]);
  });

  it('the host at the menu is away; you are never away on your own screen', () => {
    const people = cardPeople({ members: ['Ann'], cohosts: ['Ann'], owner: 'Host', me: 'Ann' });
    expect(people.map(p => [p.name, p.host, p.away])).toEqual([['Host', true, true], ['Ann', false, false]]);
  });
});
