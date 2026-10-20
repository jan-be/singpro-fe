/**
 * A number of seconds as "1 hr 12 min", "45 min" or "12 sec" in the user's
 * language (Intl unit formatting). Hours drop the seconds and minutes keep
 * them only under ten minutes, so a tile stays a few characters wide.
 */
const unit = (lang, u) => {
  const options = { style: 'unit', unit: u, unitDisplay: 'short' };
  try { return new Intl.NumberFormat(lang, options); }
  catch { return new Intl.NumberFormat('en', options); }
};

export function formatDuration(seconds, lang = 'en') {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return m > 0 ? `${unit(lang, 'hour').format(h)} ${unit(lang, 'minute').format(m)}` : unit(lang, 'hour').format(h);
  if (m >= 10 || (m > 0 && sec === 0)) return unit(lang, 'minute').format(m);
  if (m > 0) return `${unit(lang, 'minute').format(m)} ${unit(lang, 'second').format(sec)}`;
  return unit(lang, 'second').format(sec);
}
