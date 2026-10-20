/**
 * The admin page's trend charts (components/AdminTrends.jsx), out of
 * /admin/trends (backend adminTrends.js): which numbers get a chart, what a
 * day's value is, the 7-day average, the range's total and how it compares
 * with the range before.
 *
 * The backend sends counts only; a rate is worked out here from two of them,
 * always as a sum over a sum (the singers of a week over its parties), never
 * as an average of daily rates, so a quiet day with one solo party does not
 * weigh as much as a busy Saturday.
 */
import { formatDuration } from './duration';

/**
 * The charts, most telling first. `of` is the count it is made of, `per` the
 * count it is divided by (a rate), `scale` turns the count into the unit shown
 * (seconds into hours). `kind` picks the number format; a rate's `units`
 * name its two counts in the tooltip, and `context` is a count shown beside
 * the value there.
 */
export const TREND_METRICS = [
  { key: 'plays', of: 'plays' },
  { key: 'singers', of: 'singers' },
  { key: 'parties', of: 'parties' },
  { key: 'hours', of: 'seconds', scale: 1 / 3600, kind: 'hours' },
  { key: 'returning', of: 'returning', context: 'scoredSingers' },
  { key: 'singersPerParty', of: 'partySingers', per: 'parties', kind: 'rate', units: ['singer', 'party'] },
  { key: 'songsPerParty', of: 'partySongs', per: 'parties', kind: 'rate', units: ['song', 'party'] },
  { key: 'accounts', of: 'accounts' },
  { key: 'scores', of: 'scores' },
  { key: 'charts', of: 'charts' },
];

export const RANGES = [30, 90, 365];
const AVERAGE_DAYS = 7;

/** The first day a metric was recorded on (YYYY-MM-DD), or null when it always was. */
export const recordedSince = (metric, since) => since?.[metric.of] ?? null;

/** One count, or a rate of two, from a row of counts; null when a rate has nothing to divide by. */
export function valueOf(metric, counts) {
  if (!counts) return null;
  const n = Number(counts[metric.of]) || 0;
  if (!metric.per) return n * (metric.scale ?? 1);
  const d = Number(counts[metric.per]) || 0;
  return d > 0 ? n / d : null;
}

/**
 * The points of one chart: the chosen range's days, oldest first, each
 * { day, value, average, recorded, today }. `value` and `average` are null
 * where there is nothing to show (a day before the metric was recorded, a
 * rate without parties). The 7-day average reaches back into the range
 * before, so it starts on the first day too, and leaves out days that were
 * not recorded. Today's average is not drawn: the day is not over.
 */
export function seriesOf(metric, data) {
  const rows = data?.rows ?? [];
  const since = recordedSince(metric, data?.since);
  const recorded = (row) => !since || row.day >= since;
  const firstShown = rows.findIndex(r => r.day >= data.from);
  if (firstShown < 0) return [];
  const points = [];
  for (let i = firstShown; i < rows.length; i++) {
    const row = rows[i];
    const today = row.day === data.today;
    let n = 0;
    let d = 0;
    let days = 0;
    for (let j = Math.max(0, i - AVERAGE_DAYS + 1); j <= i; j++) {
      if (!recorded(rows[j])) continue;
      days++;
      n += Number(rows[j][metric.of]) || 0;
      d += metric.per ? Number(rows[j][metric.per]) || 0 : 0;
    }
    let average = null;
    if (!today && days > 0) {
      if (metric.per) average = d > 0 ? n / d : null;
      else average = (n / days) * (metric.scale ?? 1);
    }
    points.push({
      day: row.day,
      value: recorded(row) ? valueOf(metric, row) : null,
      average,
      recorded: recorded(row),
      today,
      context: metric.context ? Number(row[metric.context]) || 0 : null,
      of: metric.per ? Number(row[metric.of]) || 0 : null,
      per: metric.per ? Number(row[metric.per]) || 0 : null,
    });
  }
  return points;
}

/**
 * The range's figure and how it compares: { total, previous, change }.
 * `change` is a fraction (0.12 for +12 %), 'new' when there was nothing
 * before, or null when there is nothing to compare: both ranges empty, a rate
 * without parties before, or the range before reaching back past the day the
 * metric was first recorded.
 */
export function summaryOf(metric, data) {
  const total = valueOf(metric, data?.totals?.current);
  const previous = valueOf(metric, data?.totals?.previous);
  const since = recordedSince(metric, data?.since);
  let change = null;
  if (!(since && data.previousFrom < since)) {
    if (previous === 0) change = total ? 'new' : null;
    else if (previous != null) change = (total ?? 0) / previous - 1;
  }
  return { total, previous, change };
}

/**
 * The top of a chart's scale: a round number at or above the largest value,
 * 1, 2, 2.5 or 5 times a power of ten, so the one gridline has a plain label.
 * A chart of zeros still gets a scale (of 1), and whole counts never get a
 * fractional top.
 */
export function niceMax(max, { whole = false } = {}) {
  if (!(max > 0)) return 1;
  const power = 10 ** Math.floor(Math.log10(max));
  for (const step of [1, 2, 2.5, 5, 10]) {
    const top = step * power;
    if (top >= max - 1e-9 && (!whole || Number.isInteger(top))) return top;
  }
  return 10 * power;
}

/**
 * Bars while each day has room for one at least two pixels wide with a gap
 * beside it; narrower days (a year on a phone) become a filled area.
 */
export const drawsBars = (width, days) => width / Math.max(1, days) >= 3;

// ── Numbers and days in the reader's language ──────────────────────────────

const numberFormat = (lang, options) => {
  try { return new Intl.NumberFormat(lang, options); } catch { return new Intl.NumberFormat('en', options); }
};

/**
 * A metric's value as the cards show it: whole counts as they are (12,345,
 * 123K past a hundred thousand), averages of counts with one decimal while
 * small, rates always with one, and hours as hours, or under an hour as
 * minutes and seconds (formatDuration), so a quiet day is "12 min", not "0 hr".
 */
export function formatValue(metric, value, lang = 'en') {
  if (value == null || !Number.isFinite(value)) return '–';
  if (metric.kind === 'hours') {
    if (value < 1) return formatDuration(value * 3600, lang);
    return numberFormat(lang, { style: 'unit', unit: 'hour', unitDisplay: 'short', maximumFractionDigits: value < 10 ? 1 : 0 }).format(value);
  }
  if (metric.kind === 'rate') return numberFormat(lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value);
  if (value >= 100000) return numberFormat(lang, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
  return numberFormat(lang, { maximumFractionDigits: value < 100 && !Number.isInteger(value) ? 1 : 0 }).format(value);
}

/** A change as "▲ 12 %" / "▼ 3 %" / "± 0 %", with its direction for the colour. */
export function formatChange(change, lang = 'en') {
  const pct = numberFormat(lang, { style: 'percent', maximumFractionDigits: 0 }).format(Math.abs(change));
  if (Math.abs(change) < 0.005) return { text: `± ${pct}`, direction: 0 };
  return change > 0 ? { text: `▲ ${pct}`, direction: 1 } : { text: `▼ ${pct}`, direction: -1 };
}

const dateFormat = (lang, options) => {
  try { return new Intl.DateTimeFormat(lang, { ...options, timeZone: 'UTC' }); } catch { return new Intl.DateTimeFormat('en', { ...options, timeZone: 'UTC' }); }
};

/** A YYYY-MM-DD day as "Sat, Oct 3" (or with the year), whatever the reader's time zone. */
export function formatDay(day, lang = 'en', { weekday = false, year = false } = {}) {
  return dateFormat(lang, { day: 'numeric', month: 'short', ...(weekday ? { weekday: 'short' } : {}), ...(year ? { year: 'numeric' } : {}) })
    .format(new Date(`${day}T00:00:00Z`));
}
