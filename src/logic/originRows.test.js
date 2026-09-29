import { describe, it, expect } from 'vitest';
import { sourceRows } from './originRows';
import en from '../i18n/locales/en.json';
import de from '../i18n/locales/de.json';

// A t() over a locale file, returning the key itself when it is missing
const tFor = (res) => (key) => key.split('.').reduce((o, k) => o?.[k], res) ?? key;
const t = tFor(en);

const origins = {
  days: 30,
  direct: { sessions: 40, plays: 90 },
  referrers: [{ source: 'google', sessions: 12, plays: 30 }, { source: 'reddit.com', sessions: 2, plays: 3 }],
  arrivals: [
    { via: 'inferred', sessions: 15, plays: 41 },
    { via: 'qr', sessions: 12, plays: 50 },
    { via: 'link', sessions: 3, plays: 4 },
    { via: 'join', sessions: 1, plays: 1 },
    { via: 'invite', sessions: 1, plays: 2 },
  ],
  countries: [],
};

describe('sourceRows', () => {
  it('ranks sites, our own links and direct visits together, busiest first', () => {
    expect(sourceRows(origins, t).map(r => [r.label, r.sessions, r.plays])).toEqual([
      ['Direct, or unknown', 40, 90],
      ['Party link or QR (inferred)', 15, 41],
      ['Party QR code', 12, 50], // more plays than google breaks the tie
      ['google', 12, 30],
      ['Shared party link', 3, 4],
      ['reddit.com', 2, 3],
      ['Friend invite link', 1, 2],
      ['Party link without tag', 1, 1],
    ]);
  });

  it('marks our own links, the inferred one apart, and explains each', () => {
    const rows = Object.fromEntries(sourceRows(origins, t).map(r => [r.key, r]));
    expect(rows['via:inferred']).toMatchObject({ own: true, inferred: true });
    expect(rows['via:inferred'].hint).toMatch(/inferred|not recorded/i);
    expect(rows['via:qr']).toMatchObject({ own: true, inferred: false });
    expect(rows.google.own).toBeUndefined();
    expect(rows.direct.own).toBeUndefined();
    for (const via of ['qr', 'link', 'join', 'invite', 'inferred']) expect(rows[`via:${via}`].hint).not.toMatch(/^admin\./);
  });

  it('a site called "qr" cannot collide with the QR code row', () => {
    const rows = sourceRows({ ...origins, referrers: [{ source: 'qr', sessions: 1, plays: 1 }] }, t);
    expect(new Set(rows.map(r => r.key)).size).toBe(rows.length);
  });

  it('works with a backend from before the arrivals', () => {
    const { arrivals, ...old } = origins;
    expect(sourceRows(old, t).map(r => r.key)).toEqual(['direct', 'google', 'reddit.com']);
  });

  it('shows a way it does not know by its name, and no direct row without direct plays', () => {
    const rows = sourceRows({ ...origins, direct: { sessions: 0, plays: 0 }, arrivals: [{ via: 'nfc', sessions: 1, plays: 1 }] }, t);
    expect(rows.map(r => r.label)).toEqual(['google', 'reddit.com', 'nfc']);
    expect(sourceRows(null, t)).toEqual([]);
  });

  it('every label and hint is there in English and German', () => {
    for (const res of [en, de]) {
      const tr = tFor(res);
      for (const via of ['qr', 'link', 'join', 'invite', 'inferred']) {
        expect(tr(`admin.origins.via.${via}`)).not.toMatch(/^admin\./);
        expect(tr(`admin.origins.viaHint.${via}`)).not.toMatch(/^admin\./);
      }
    }
  });
});
