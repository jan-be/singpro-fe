/**
 * "3 min. ago", "yesterday", "in 2 hr." in the user's language, through
 * Intl.RelativeTimeFormat. The unit grows with the distance: seconds up to a
 * minute, minutes up to an hour, and so on to years. Under 45 seconds it is
 * simply "now".
 */
const UNITS = [['second', 60], ['minute', 60], ['hour', 24], ['day', 7], ['week', 4.348], ['month', 12], ['year', Infinity]];

const formatter = (lang) => {
  try { return new Intl.RelativeTimeFormat(lang, { numeric: 'auto', style: 'short' }); }
  catch { return new Intl.RelativeTimeFormat('en', { numeric: 'auto', style: 'short' }); }
};

export function timeAgo(date, { now = Date.now(), lang = 'en' } = {}) {
  const t = date == null ? NaN : new Date(date).getTime(); // new Date(null) would be 1970
  if (!Number.isFinite(t)) return '';
  let value = (t - now) / 1000;
  let unit = 'second';
  for (const [name, next] of UNITS) {
    unit = name;
    if (Math.abs(value) < next) break;
    value /= next;
  }
  if (unit === 'second' && Math.abs(value) < 45) value = 0;
  const rounded = Math.sign(value) * Math.round(Math.abs(value)); // Math.round(-1.5) is -1: halves go away from zero either way
  return formatter(lang).format(rounded, unit);
}
