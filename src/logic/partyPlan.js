/**
 * "Plan the next one" after a long party: a calendar entry (.ics) whose link
 * starts the party again with the same songs, on whatever device opens it
 * (the entry page's ?again=id.id… shows the songs with Start again).
 */

export const MAX_PLAN_SONGS = 30;
const ID = /^[A-Za-z0-9_-]{4,64}$/;

/** The link that starts a party with these songs again */
export function planUrl(origin, songs) {
  const ids = songs.map(s => s.songId).filter(id => ID.test(id)).slice(0, MAX_PLAN_SONGS);
  return `${origin}/?again=${ids.join('.')}`;
}

/** ?again=id.id… → the song ids (unknown shapes dropped) */
export function parseAgain(value) {
  if (typeof value !== 'string') return [];
  return [...new Set(value.split('.').filter(id => ID.test(id)))].slice(0, MAX_PLAN_SONGS);
}

/**
 * The same weekday and time as the last party, a week on (or more, until it
 * is ahead of now). By the calendar, not 168 hours: across a clock change
 * the party stays at its hour.
 */
export function nextSameTime(startedAt, now = Date.now()) {
  const d = new Date(startedAt);
  d.setMinutes(d.getMinutes() < 30 ? 0 : 30, 0, 0); // on the half hour
  do d.setDate(d.getDate() + 7); while (d.getTime() < now + 3600 * 1000);
  return d;
}

/** A Date for <input type="datetime-local"> (local time, minutes) */
export function toLocalInput(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}`;
}

/** <input type="datetime-local">'s value → a Date (local time), or null */
export function fromLocalInput(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value ?? '');
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  return Number.isNaN(d.getTime()) ? null : d;
}

const utc = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const text = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Lines longer than 75 octets go on in the next line after a space (RFC 5545 3.1) */
function fold(line) {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out = [];
  let cur = '', size = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (size + n > (out.length ? 74 : 75)) { out.push(cur); cur = ''; size = 0; }
    cur += ch; size += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

/** The calendar file: one event of `hours` from `start`, its link in the text and as its URL */
export function icsEvent({ start, hours = 3, title, description, url, uid, now = new Date() }) {
  const end = new Date(start.getTime() + hours * 3600 * 1000);
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//singpro.app//Plan the next party//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${utc(now)}`,
    `DTSTART:${utc(start)}`,
    `DTEND:${utc(end)}`,
    `SUMMARY:${text(title)}`,
    `DESCRIPTION:${text(description)}`,
    `URL:${url}`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].map(fold).join('\r\n');
}

/** Hands the file to the browser (a download; iOS opens it in the calendar) */
export function downloadIcs(content, filename = 'singpro-party.ics') {
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}
