import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import ChartJobProgress from './ChartJobProgress';
import { Badge, FilterButtons, Section, StatTile, Thumb, btn } from './AdminParts';
import { timeAgo } from '../logic/timeAgo';
import { formatDuration } from '../logic/duration';
import { formatTime } from '../logic/songRegions';
import { forgetChartAccess } from '../logic/chartJobs';
import { ACCESS_LEVELS, JOB_FILTERS, STATUS_TONE, errorKey, jobTimes, qaReason } from '../logic/chartJobAdmin';
import { adminSetChartAccess, getAdminChartAccess, getAdminChartJobs } from '../logic/authApi';
import { errorMessage } from '../pages/AuthPage';

/**
 * /admin's AI karaoke charts (backend chartJobs.js, GET /admin/chart-jobs):
 * the switch for who may have them made, the numbers, and every job with who
 * asked, how far it got and what became of it.
 *
 * active: the overview's count of unfinished jobs, which AdminPage polls every
 * few seconds anyway. While it is above zero the list follows the running
 * jobs every REFRESH_MS (their progress and times move); when it changes (a
 * job asked for, one finished) the list is read again. An idle list costs no
 * requests at all.
 */

const REFRESH_MS = 5000;
const PAGE = 20;
const MAX_ROWS = 100; // the backend's page limit: a refresh reads the rows on screen again, up to this many
const UNFINISHED = new Set(['queued', 'downloading', 'generating']);

const useAgo = () => {
  const { i18n } = useTranslation();
  return (d) => timeAgo(d, { lang: i18n.language });
};

const compact = (n, lang) => {
  try { return new Intl.NumberFormat(lang, { notation: 'compact' }).format(n); } catch { return String(n); }
};

const LEVEL_TONE = {
  off: 'text-red-400 bg-red-500/10',
  admins: 'text-neon-magenta bg-neon-magenta/10',
  everyone: 'text-neon-green bg-neon-green/10',
};

/** Off / Admins only / Everyone signed in, with who switched it last (or what applies while nobody has) */
const AccessSwitch = ({ state, limits, busy, onSwitch }) => {
  const { t } = useTranslation();
  const ago = useAgo();
  const level = (l) => t(`admin.chartJobs.access.levels.${l}`);
  return (
    <div className="rounded-xl bg-surface-light border border-surface-lighter p-3 sm:p-4 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-gray-400 uppercase tracking-wider">{t('admin.chartJobs.access.title')}</div>
        <div role="radiogroup" aria-label={t('admin.chartJobs.access.title')} className="flex rounded-lg border border-surface-lighter overflow-hidden">
          {ACCESS_LEVELS.map(l => (
            <button
              key={l}
              type="button"
              role="radio"
              aria-checked={state.access === l}
              disabled={busy}
              onClick={() => onSwitch(l)}
              className={`px-3 py-1.5 text-sm font-semibold border-l first:border-l-0 border-surface-lighter transition-colors cursor-pointer disabled:cursor-not-allowed ${
                state.access === l ? LEVEL_TONE[l] : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
            >
              {level(l)}
            </button>
          ))}
        </div>
      </div>
      <p className="text-sm text-gray-300">{t(`admin.chartJobs.access.explain.${state.access}`, { perUser: limits?.userDaily ?? '?', daily: limits?.daily ?? '?' })}</p>
      <p className="text-xs text-gray-500">
        {state.stored
          ? t('admin.chartJobs.access.setBy', { level: level(state.stored.access), name: state.stored.updatedBy ?? t('admin.chartJobs.deletedAccount'), time: ago(state.stored.updatedAt) })
          : t(`admin.chartJobs.access.fallback.${state.fallback.from}`, { level: level(state.fallback.access) })}
      </p>
      {!state.generator && <p className="text-xs text-yellow-400">{t('admin.chartJobs.access.noGenerator')}</p>}
    </div>
  );
};

/** What became of a job: the QA gate's verdict with its reasons, or why it failed, in words */
const Outcome = ({ job, limits }) => {
  const { t } = useTranslation();
  if (job.status === 'failed') {
    return (
      <p className="text-sm text-red-400">
        {t(`admin.chartJobs.errors.${errorKey(job.error)}`, {
          duration: job.durationS ? formatTime(job.durationS) : '?', max: limits?.maxSeconds ? formatTime(limits.maxSeconds) : '?',
        })}
      </p>
    );
  }
  const qa = job.qa;
  if (!qa?.decision) return null;
  const tone = { publish: 'text-neon-green', beta: 'text-yellow-400', hold: 'text-red-400' }[qa.decision] ?? 'text-gray-300';
  const reasons = (qa.reasons ?? []).map(qaReason);
  return (
    <div className="text-sm">
      <span className={tone}>{t(`admin.chartJobs.verdict.${qa.decision}`, { defaultValue: qa.decision })}</span>
      {qa.predicted != null && <span className="text-gray-500"> · {t('admin.chartJobs.predicted', { score: Number(qa.predicted).toFixed(2) })}</span>}
      {reasons.length > 0 && (
        <ul className="mt-1 space-y-0.5 pl-4 list-disc text-xs text-gray-400">
          {reasons.map((r, i) => <li key={i}>{r.key ? t(`admin.chartJobs.reasons.${r.key}`, r.values) : r.text}</li>)}
        </ul>
      )}
    </div>
  );
};

/**
 * One job: the video (opens the song once there is one, else the video on
 * YouTube), its state, live progress while it runs, the outcome, who asked,
 * and how long it waited for a slot and then took.
 */
const JobRow = ({ job, limits }) => {
  const { t, i18n } = useTranslation();
  const ago = useAgo();
  const dur = (s) => formatDuration(s, i18n.language);
  const times = jobTimes(job);
  const running = job.status === 'downloading' || job.status === 'generating';
  const timeWords = job.status === 'queued'
    ? [t('admin.chartJobs.times.waiting', { time: dur(times.waited) })]
    : [
      times.waited != null && t('admin.chartJobs.times.waited', { time: dur(times.waited) }),
      times.took != null && t(running ? 'admin.chartJobs.times.running' : 'admin.chartJobs.times.took', { time: dur(times.took) }),
      times.took == null && times.total != null && t('admin.chartJobs.times.total', { time: dur(times.total) }),
    ].filter(Boolean);
  const facts = [job.artist, job.durationS ? formatTime(job.durationS) : null,
    job.viewCount ? t('admin.chartJobs.views', { views: compact(job.viewCount, i18n.language) }) : null].filter(Boolean);

  const head = (
    <>
      <Thumb videoId={job.videoId} />
      <div className="min-w-0">
        <div className="text-sm text-white truncate">{job.title ?? job.videoId}</div>
        <div className="text-xs text-gray-400 truncate">{facts.length ? facts.join(' · ') : t('admin.chartJobs.nameUnknown')}</div>
      </div>
    </>
  );
  const linkClass = 'flex items-center gap-3 min-w-0 rounded-lg -mx-1 px-1 hover:bg-white/5 transition-colors';
  const songThere = job.status === 'done' && job.songId && job.songExists;

  return (
    <li className="rounded-lg bg-surface-light border border-surface-lighter px-3 py-2.5 space-y-2">
      <div className="flex items-start justify-between gap-3">
        {songThere
          ? <Link to={`/sing/${job.songId}`} title={t('admin.chartJobs.openSong')} className={linkClass}>{head}</Link>
          : <a href={`https://www.youtube.com/watch?v=${job.videoId}`} target="_blank" rel="noreferrer" title={t('admin.chartJobs.openVideo')} className={linkClass}>{head}</a>}
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <Badge tone={STATUS_TONE[job.status]}>{t(`admin.chartJobs.status.${job.status}`, { defaultValue: job.status })}</Badge>
          {job.songId && <span className="text-xs font-mono text-gray-400 whitespace-nowrap">{t('admin.chartJobs.plays', { count: job.plays })}</span>}
        </div>
      </div>
      {UNFINISHED.has(job.status) && <ChartJobProgress job={job} />}
      <Outcome job={job} limits={limits} />
      <div className="text-xs text-gray-500">
        {job.username
          ? <Link to={`/u/${encodeURIComponent(job.username)}`} className="text-neon-cyan hover:underline">{job.username}</Link>
          : <span>{t('admin.chartJobs.deletedAccount')}</span>}
        {' · '}{ago(job.createdAt)}
        {timeWords.length ? ` · ${timeWords.join(' · ')}` : ''}
        {job.status === 'done' && !job.songExists ? ` · ${t('admin.chartJobs.songGone')}` : ''}
      </div>
    </li>
  );
};

const AdminChartJobs = ({ active }) => {
  const { t, i18n } = useTranslation();
  const [filter, setFilter] = useState('all');
  const [list, setList] = useState(null); // { rows, hasMore, counts, stats }
  const [access, setAccess] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);
  const filterRef = useRef(filter);
  filterRef.current = filter;
  const shown = useRef(PAGE); // rows on screen, so a refresh keeps "show more"

  const load = useCallback(async (f, count) => {
    const p = await getAdminChartJobs(f, 0, Math.min(MAX_ROWS, Math.max(PAGE, count)));
    if (f !== filterRef.current) return; // another filter was picked meanwhile
    const receivedAt = Date.now(); // ChartJobProgress moves the bars on from here between refreshes
    setList({ rows: p.data.map(j => ({ ...j, receivedAt })), hasMore: p.hasMore, counts: p.counts, stats: p.stats });
    shown.current = Math.max(PAGE, p.data.length);
  }, []);
  const refresh = useCallback(() => load(filterRef.current, shown.current).catch(e => setErr(errorMessage(t, e))), [load, t]);

  useEffect(() => {
    setList(null);
    shown.current = PAGE;
    load(filter, PAGE).catch(e => setErr(errorMessage(t, e)));
  }, [filter, load, t]);

  useEffect(() => {
    getAdminChartAccess().then(setAccess).catch(e => setErr(errorMessage(t, e)));
  }, [t]);

  // A job asked for or finished since the last read: the overview counts the unfinished ones differently
  const unfinished = list ? list.stats.running + list.stats.queued : null;
  useEffect(() => {
    if (active == null || unfinished == null || active === unfinished) return;
    refresh();
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  const following = Math.max(active ?? 0, unfinished ?? 0) > 0;
  useEffect(() => {
    if (!following) return undefined;
    const id = setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, REFRESH_MS);
    return () => clearInterval(id);
  }, [following, refresh]);

  const more = async () => {
    setBusy(true); setErr(null);
    try {
      const p = await getAdminChartJobs(filter, list.rows.length, PAGE);
      const receivedAt = Date.now();
      shown.current = list.rows.length + p.data.length;
      setList(s => ({ ...s, rows: [...s.rows, ...p.data.map(j => ({ ...j, receivedAt }))], hasMore: p.hasMore, counts: p.counts, stats: p.stats }));
    } catch (e) { setErr(errorMessage(t, e)); } finally { setBusy(false); }
  };

  const limits = list?.stats.limits;
  const switchTo = async (level) => {
    if (!access || level === access.access) return;
    const levelName = t(`admin.chartJobs.access.levels.${level}`);
    if (level === 'everyone' && !window.confirm(t('admin.chartJobs.access.confirmEveryone', { perUser: limits?.userDaily ?? '?', daily: limits?.daily ?? '?' }))) return;
    setBusy(true); setErr(null); setMsg(null);
    try {
      setAccess(await adminSetChartAccess(level));
      forgetChartAccess(); // this tab's search bar and party queue ask again
      setMsg(t('admin.chartJobs.access.switched', { level: levelName }));
    } catch (e) { setErr(errorMessage(t, e)); } finally { setBusy(false); }
  };

  const s = list?.stats;
  const loading = <div className="text-neon-cyan text-center py-6 animate-pulse">{t('sections.loading')}</div>;

  return (
    <Section title={t('admin.chartJobs.title')}>
      <p className="text-xs text-gray-500 mb-3">{t('admin.chartJobs.hint')}</p>
      {msg && <div className="mb-3 text-sm text-neon-green" role="status">{msg}</div>}
      {err && <div className="mb-3 text-sm text-red-400" role="alert">{err}</div>}

      {access && <AccessSwitch state={access} limits={limits} busy={busy} onSwitch={switchTo} />}

      {s && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 mt-3">
          <StatTile label={t('admin.chartJobs.stats.day')} value={`${s.dayCounted} / ${s.limits.daily}`} accent={s.dayCounted >= s.limits.daily ? 'text-red-400' : 'text-white'} />
          <StatTile
            label={s.queued > 0 ? t('admin.chartJobs.stats.runningQueued', { count: s.queued }) : t('admin.chartJobs.stats.running')}
            value={`${s.running} / ${s.limits.maxActive}`}
            accent="text-neon-cyan"
          />
          <StatTile label={t('admin.chartJobs.stats.median')} value={s.medianReadyS == null ? '–' : formatDuration(s.medianReadyS, i18n.language)} small />
          <StatTile label={t('admin.chartJobs.stats.songs')} value={s.songs} accent="text-neon-magenta" />
          <StatTile label={t('admin.chartJobs.stats.done')} value={s.doneWeek} accent="text-neon-green" />
          <StatTile label={t('admin.chartJobs.stats.rejected')} value={s.rejectedWeek} accent="text-yellow-400" />
          <StatTile label={t('admin.chartJobs.stats.failed')} value={s.failedWeek} accent="text-red-400" />
          <StatTile label={t('admin.chartJobs.stats.plays')} value={s.playsWeek} />
        </div>
      )}

      <div className="mt-4 mb-2">
        <FilterButtons options={JOB_FILTERS} value={filter} onChange={setFilter} label={f => t(`admin.chartJobs.filter.${f}`)} counts={list?.counts} />
      </div>
      {!list
        ? loading
        : (
          <ul className="space-y-1.5">
            {list.rows.length === 0 && <li className="text-sm text-gray-500">{t('admin.chartJobs.none')}</li>}
            {list.rows.map(j => <JobRow key={j.id} job={j} limits={limits} />)}
          </ul>
        )}
      {list?.hasMore && <button type="button" disabled={busy} onClick={more} className={`${btn.quiet} mt-3`}>{t('admin.showMore')}</button>}
    </Section>
  );
};

export default AdminChartJobs;
