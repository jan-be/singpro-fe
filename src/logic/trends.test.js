import { describe, it, expect } from 'vitest';
import { TREND_METRICS, seriesOf, summaryOf, niceMax, valueOf, drawsBars, formatValue, formatChange, formatDay } from './trends';
import en from '../i18n/locales/en.json';
import de from '../i18n/locales/de.json';

const metric = (key) => TREND_METRICS.find(m => m.key === key);
const zero = { plays: 0, singers: 0, parties: 0, partySingers: 0, partySongs: 0, seconds: 0, scores: 0, scoredSingers: 0, returning: 0, accounts: 0, charts: 0 };

/** Ten days to 2026-10-04, the last five of them the chosen range, with `counts` per day. */
function data(counts = {}, { since = {}, totals } = {}) {
  const days = ['09-25', '09-26', '09-27', '09-28', '09-29', '09-30', '10-01', '10-02', '10-03', '10-04'].map(d => `2026-${d}`);
  return {
    days: 5,
    today: '2026-10-04',
    from: '2026-09-30',
    previousFrom: '2026-09-25',
    rows: days.map(day => ({ day, ...zero, ...counts[day] })),
    totals: totals ?? { current: { ...zero }, previous: { ...zero } },
    since,
  };
}

describe('trend series', () => {
  it('shows the chosen range only, with a 7-day average that reaches into the range before', () => {
    const d = data({ '2026-09-28': { plays: 7 }, '2026-10-01': { plays: 14 }, '2026-10-04': { plays: 3 } });
    const points = seriesOf(metric('plays'), d);
    expect(points.map(p => p.day)).toEqual(['2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
    expect(points.map(p => p.value)).toEqual([0, 14, 0, 0, 3]);
    expect(points[0].average).toBeCloseTo(7 / 6); // the six days of data up to Sept 30, only the 28th with plays
    expect(points[1].average).toBeCloseTo(21 / 7);
    expect(points[3].average).toBeCloseTo(21 / 7);
    // today is not over: its bar is there, its average is not
    expect(points[4]).toMatchObject({ today: true, average: null, value: 3 });
  });

  it('turns seconds into hours', () => {
    const points = seriesOf(metric('hours'), data({ '2026-10-02': { seconds: 5400 } }));
    expect(points[2].value).toBe(1.5);
  });

  it('works a rate out as a sum over a sum, and leaves days without parties empty', () => {
    const d = data({
      '2026-10-01': { partySingers: 1, parties: 1 },
      '2026-10-02': { partySingers: 12, parties: 2 },
    });
    const points = seriesOf(metric('singersPerParty'), d);
    expect(points[0].value).toBeNull(); // no party on Sept 30
    expect(points[1].value).toBe(1);
    expect(points[2].value).toBe(6);
    expect(points[2].average).toBeCloseTo(13 / 3); // not (1 + 6) / 2
    expect(points[2]).toMatchObject({ of: 12, per: 2 });
  });

  it('days before a metric was recorded have no value and stay out of the average', () => {
    const d = data({ '2026-10-01': { scores: 4 }, '2026-10-02': { scores: 2 } }, { since: { scores: '2026-10-01' } });
    const points = seriesOf(metric('scores'), d);
    expect(points[0]).toMatchObject({ recorded: false, value: null, average: null });
    expect(points[1]).toMatchObject({ recorded: true, value: 4, average: 4 });
    expect(points[2].average).toBe(3);
    // a metric without a first day is recorded throughout
    expect(seriesOf(metric('plays'), d).every(p => p.recorded)).toBe(true);
  });

  it('carries the context a count is told with', () => {
    const points = seriesOf(metric('returning'), data({ '2026-10-03': { returning: 2, scoredSingers: 9 } }));
    expect(points[3]).toMatchObject({ value: 2, context: 9 });
  });
});

describe('trend summary', () => {
  const totals = (current, previous) => ({ current: { ...zero, ...current }, previous: { ...zero, ...previous } });

  it('compares the range with the one before', () => {
    expect(summaryOf(metric('plays'), data({}, { totals: totals({ plays: 112 }, { plays: 100 }) }))).toEqual({ total: 112, previous: 100, change: expect.closeTo(0.12) });
    expect(summaryOf(metric('plays'), data({}, { totals: totals({ plays: 50 }, { plays: 100 }) })).change).toBeCloseTo(-0.5);
  });

  it('says new when there was nothing before, nothing when there is nothing at all', () => {
    expect(summaryOf(metric('charts'), data({}, { totals: totals({ charts: 3 }, {}) })).change).toBe('new');
    expect(summaryOf(metric('charts'), data({}, { totals: totals({}, {}) })).change).toBeNull();
  });

  it('does not compare with a range from before the metric was recorded', () => {
    const d = data({}, { totals: totals({ seconds: 7200 }, { seconds: 600 }), since: { seconds: '2026-09-27' } });
    expect(summaryOf(metric('hours'), d)).toEqual({ total: 2, previous: 600 / 3600, change: null });
  });

  it('a rate over the whole range', () => {
    const d = data({}, { totals: totals({ partySongs: 30, parties: 4 }, { partySongs: 10, parties: 0 }) });
    expect(summaryOf(metric('songsPerParty'), d)).toEqual({ total: 7.5, previous: null, change: null }); // no parties before: nothing to compare
  });
});

describe('trend scale', () => {
  it('rounds the top up to a plain number', () => {
    expect([0, 0.3, 1, 3, 7, 11, 23, 42, 99, 101, 2600].map(m => niceMax(m))).toEqual([1, 0.5, 1, 5, 10, 20, 25, 50, 100, 200, 5000]);
    expect(niceMax(2.2, { whole: true })).toBe(5); // not 2.5
    expect(niceMax(0.4, { whole: true })).toBe(1);
  });

  it('draws bars while there is room, an area when there is not', () => {
    expect(drawsBars(190, 30)).toBe(true);
    expect(drawsBars(190, 90)).toBe(false);
    expect(drawsBars(380, 90)).toBe(true);
  });

  it('a missing row has no value', () => {
    expect(valueOf(metric('plays'), null)).toBeNull();
  });
});

describe('trend formats', () => {
  it('counts, averages, rates and hours', () => {
    expect(formatValue(metric('plays'), 12345)).toBe('12,345');
    expect(formatValue(metric('plays'), 123456)).toBe('123.5K');
    expect(formatValue(metric('plays'), 2.43)).toBe('2.4'); // an average
    expect(formatValue(metric('plays'), 0)).toBe('0');
    expect(formatValue(metric('singersPerParty'), 3)).toBe('3.0');
    expect(formatValue(metric('hours'), 2.25)).toBe('2.3 hr');
    expect(formatValue(metric('hours'), 123.4)).toBe('123 hr');
    expect(formatValue(metric('hours'), 0.2)).toBe('12 min'); // not "0 hr"
    expect(formatValue(metric('hours'), 42 / 3600)).toBe('42 sec');
    expect(formatValue(metric('plays'), null)).toBe('–');
    expect(formatValue(metric('singersPerParty'), 2.5, 'de')).toBe('2,5');
  });

  it('changes with their direction', () => {
    expect(formatChange(0.123)).toEqual({ text: '▲ 12%', direction: 1 });
    expect(formatChange(-0.5)).toEqual({ text: '▼ 50%', direction: -1 });
    expect(formatChange(0.001)).toEqual({ text: '± 0%', direction: 0 });
    expect(formatChange(0.12, 'de').text).toMatch(/^▲ 12\s%$/); // a no-break space in German
  });

  it('days stay the day they are, wherever the reader is', () => {
    expect(formatDay('2026-10-03')).toBe('Oct 3');
    expect(formatDay('2026-10-03', 'en', { weekday: true })).toBe('Sat, Oct 3');
    expect(formatDay('2025-10-05', 'de', { year: true })).toBe('5. Okt. 2025');
  });
});

describe('trend strings', () => {
  it('every chart has a label, a hint and a unit in English and German', () => {
    for (const lang of [en, de]) {
      for (const m of TREND_METRICS) {
        const s = lang.admin.trends.metrics[m.key];
        expect(s?.label, `${m.key}.label`).toBeTruthy();
        expect(s?.hint, `${m.key}.hint`).toBeTruthy();
        if (m.kind !== 'hours') expect(s?.unit_other, `${m.key}.unit_other`).toBeTruthy();
      }
    }
  });
});
