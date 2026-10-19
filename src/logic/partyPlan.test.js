import { describe, test, expect } from 'vitest';
import { planUrl, parseAgain, nextSameTime, toLocalInput, fromLocalInput, icsEvent, MAX_PLAN_SONGS } from './partyPlan';

describe('partyPlan', () => {
  test('the link carries the song ids, read back without junk or repeats', () => {
    const url = planUrl('https://singpro.app', [{ songId: 'aB3dE5fG7hJ' }, { songId: 'x' }, { songId: 'zz-Y_9q' }]);
    expect(url).toBe('https://singpro.app/?again=aB3dE5fG7hJ.zz-Y_9q');
    expect(parseAgain('aB3dE5fG7hJ.zz-Y_9q.aB3dE5fG7hJ.<script>.ab')).toEqual(['aB3dE5fG7hJ', 'zz-Y_9q']);
    expect(parseAgain(null)).toEqual([]);
    expect(parseAgain(Array.from({ length: 40 }, (_, i) => `song${i}`).join('.'))).toHaveLength(MAX_PLAN_SONGS);
  });

  test('next time: the same weekday and time a week on, ahead of now, on the half hour', () => {
    const last = new Date(2026, 9, 17, 20, 10).getTime(); // a Saturday, 20:10
    const next = nextSameTime(last, new Date(2026, 9, 19, 12, 0).getTime());
    expect([next.getDay(), next.getHours(), next.getMinutes(), next.getDate()]).toEqual([6, 20, 0, 24]);
    const later = nextSameTime(last, new Date(2026, 9, 30).getTime());
    expect(later.getDate()).toBe(31);
    // across the clock change (25 Oct 2026 in Europe) it stays at 20:00 local
    const monday = nextSameTime(new Date(2026, 9, 19, 20, 0).getTime(), new Date(2026, 9, 19, 21, 0).getTime());
    expect([monday.getDate(), monday.getHours()]).toEqual([26, 20]);
  });

  test('datetime-local values both ways', () => {
    const d = new Date(2026, 9, 24, 20, 30);
    expect(toLocalInput(d)).toBe('2026-10-24T20:30');
    expect(fromLocalInput('2026-10-24T20:30').getTime()).toBe(d.getTime());
    expect(fromLocalInput('')).toBe(null);
  });

  test('the calendar file: UTC times, escaped text, lines folded at 75 octets, CRLF', () => {
    const ics = icsEvent({
      start: new Date(Date.UTC(2026, 9, 24, 18, 0)), hours: 3,
      title: 'Karaoke party; with friends', description: `Start the party: https://singpro.app/?again=${'aB3dE5fG7hJ.'.repeat(8)}x1234`,
      url: 'https://singpro.app/?again=abcd', uid: '1-K7QX@singpro.app', now: new Date(Date.UTC(2026, 9, 19, 10, 0)),
    });
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('DTSTART:20261024T180000Z\r\n');
    expect(ics).toContain('DTEND:20261024T210000Z\r\n');
    expect(ics).toContain('SUMMARY:Karaoke party\\; with friends\r\n');
    for (const line of ics.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    // unfolded, the description is whole again
    expect(ics.replace(/\r\n /g, '')).toContain(`DESCRIPTION:Start the party: https://singpro.app/?again=${'aB3dE5fG7hJ.'.repeat(8)}x1234`);
    expect(ics.split('\n').every(l => l === '' || l.endsWith('\r') || l === ics.split('\n').at(-1))).toBe(true);
  });
});
