/**
 * The admin page's AI karaoke charts (components/AdminChartJobs.jsx, backend
 * GET /admin/chart-jobs): a job row's times and the generator's QA reasons in
 * words an admin can act on.
 */

/** The list's status filter, as the backend takes it: everything, the unfinished ones, or one outcome */
export const JOB_FILTERS = ['all', 'active', 'done', 'rejected', 'failed'];

/** Who may have charts made (the backend's chartAccess()), in the order the switch shows them */
export const ACCESS_LEVELS = ['off', 'admins', 'everyone'];

/** A status badge's colour */
export const STATUS_TONE = { queued: 'gray', downloading: 'cyan', generating: 'cyan', done: 'green', rejected: 'yellow', failed: 'red' };

/** Error codes the backend stores on a job (chartJobs.js); anything else reads as 'error' */
const ERRORS = new Set(['live', 'too_long', 'download', 'generator', 'timeout', 'qa_hold', 'error']);
export const errorKey = (code) => (ERRORS.has(code) ? code : 'error');

const seconds = (from, to) => (from == null || to == null ? null : Math.max(0, Math.round((to - from) / 1000)));
const time = (d) => (d ? Date.parse(d) : null);

/**
 * How long a job waited for a free slot and how long it ran, in seconds; an
 * unfinished one counts up to `now`. Jobs from before the start time was kept
 * know only the `total`: waited and took are null there.
 */
export function jobTimes(job, now = Date.now()) {
  const created = time(job.createdAt);
  const started = time(job.startedAt);
  const end = time(job.finishedAt) ?? now;
  if (started == null) return { waited: job.status === 'queued' ? seconds(created, now) : null, took: null, total: seconds(created, end) };
  return { waited: seconds(created, started), took: seconds(started, end), total: seconds(created, end) };
}

// The generator's QA flags (singpro-chartgen data/rule.json) by the signal each one names
const SIGNALS = {
  w_words_per_min: 'fewWords',
  p_freestyle: 'noPitch',
  l_has_lyrics: 'noLyrics',
  c_latin_share: 'notLatin',
  e_dyn_range: 'leakyStem',
  w_unvoiced_words: 'unvoicedWords',
};

/**
 * One of the QA gate's reasons (singpro-chartgen qa.py: a flag's "why" and
 * "(signal=value)", "predicted score 0.35 < 0.4", or the note that the chart
 * was remade from what Whisper heard) -> { key (under
 * admin.chartJobs.reasons), values } or, for one this does not know, { text }.
 */
export function qaReason(reason) {
  const text = String(reason ?? '');
  let m = text.match(/^predicted score (-?[\d.]+) < ([\d.]+)/);
  if (m) return { key: 'predicted', values: { score: Number(m[1]).toFixed(2), limit: Number(m[2]).toFixed(2) } };
  if (text.startsWith('the lyrics found did not match the singing')) return { key: 'regenerated', values: {} };
  m = text.match(/\((\w+)=(-?[\d.]+)\)\s*$/);
  if (m) {
    const value = Number(m[2]);
    const values = { value: Math.round(value * 10) / 10, pct: Math.round(value * 100) };
    // one signal, two flags (hardly anything matches: held; only part of it: beta), and both fire for a
    // share under both limits, so the flag's own words tell them apart
    if (m[1] === 'm_match_share') return { key: text.startsWith('only part') ? 'lyricsPartial' : 'lyricsMismatch', values };
    if (SIGNALS[m[1]]) return { key: SIGNALS[m[1]], values };
  }
  return { text };
}
