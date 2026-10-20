import React, { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useMeasure from 'react-use-measure';
import { getAdminTrends } from '../logic/authApi';
import { errorMessage } from '../pages/AuthPage';
import { Hint, Loading, Notice, panel } from './AdminParts';
import {
  TREND_METRICS, RANGES, seriesOf, summaryOf, niceMax, drawsBars, formatValue, formatChange, formatDay, recordedSince,
} from '../logic/trends';

/**
 * "Trends" on /admin: a small chart per number that matters (logic/trends.js
 * has the list and the arithmetic, backend adminTrends.js the counting), each
 * with the figure for the chosen days, how it compares with as many days
 * before, the days as bars (an area when they get too narrow) and their 7-day
 * average as a line. Pointing at a day marks it in every chart, so a busy
 * Saturday can be followed across them; the chart under the pointer (or the
 * finger) says the numbers. Hand-drawn SVG: a chart library would weigh more
 * than the whole admin page.
 */

const LABEL_BAND = 11; // room above the top gridline for its label
const HEIGHT = { wide: 104, small: 72 };
const WIDE = new Set(['plays', 'singers']); // the two headline numbers get a row of their own

// On the violet panel: the days in a recessive blue, their average in the
// sign's pink on top, the pointed-at day lit in bright cyan (checked for
// colour-blind separation against the panel)
const PANEL = '#221c42';
const BAR = '#1d7ea4';
const BAR_LIT = '#5fd3ee';
const AVERAGE = '#ff4fd8';

/** Where a value sits (the baseline at the bottom, `top` at the top gridline) and how wide a day's bar is. */
const geometry = (slot, height, top) => {
  const base = height - 0.5;
  const gap = slot >= 6 ? 2 : 1;
  return { base, y: (v) => base - (Math.min(v, top) / top) * (base - LABEL_BAND), barWidth: Math.min(24, slot - gap) };
};

/** The days (and their 7-day average) of one metric. Drawn once per data and size, not on every pointer move. */
const Plot = memo(({ points, width, height, bars, top, topLabel }) => {
  const n = points.length;
  const slot = width / n;
  const { base, y, barWidth } = geometry(slot, height, top);
  const firstRecorded = points.findIndex(p => p.recorded);

  // Runs of days with a value (a rate has none on a day without parties, nothing has one before it was recorded)
  const runs = (key, shown = () => true) => {
    const out = [];
    let run = null;
    points.forEach((p, i) => {
      if (p[key] == null || !shown(i)) { run = null; return; }
      if (!run) out.push(run = []);
      run.push([(i + 0.5) * slot, y(p[key])]);
    });
    return out;
  };
  // The average lies on the baseline through quiet weeks; drawn there it only
  // doubles the baseline in magenta, so it keeps just the days next to activity,
  // where it rises and falls
  const active = (i) => points[i]?.average > 0;
  const lively = (i) => active(i - 1) || active(i) || active(i + 1);
  const line = (run) => run.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join('');

  return (
    <g>
      {firstRecorded !== 0 && (
        <rect x={0} y={LABEL_BAND} width={(firstRecorded < 0 ? n : firstRecorded) * slot} height={base - LABEL_BAND} className="fill-white/[0.04]" />
      )}
      <line x1={0} x2={width} y1={LABEL_BAND + 0.5} y2={LABEL_BAND + 0.5} className="stroke-white/10" />
      <line x1={0} x2={width} y1={base} y2={base} className="stroke-white/20" />
      <text x={0} y={LABEL_BAND - 3} className="fill-white/40 tabular-nums" fontSize={9.5}>{topLabel}</text>
      {bars
        ? points.map((p, i) => {
          if (!(p.value > 0)) return null;
          // the smallest count still shows: a day with one play is not a day with none
          const h = Math.max(1.5, base - y(p.value));
          const x = i * slot + (slot - barWidth) / 2;
          const r = Math.min(2, barWidth / 2, h);
          return (
            <path
              key={p.day}
              d={`M${x},${base}V${base - h + r}Q${x},${base - h} ${x + r},${base - h}H${x + barWidth - r}Q${x + barWidth},${base - h} ${x + barWidth},${base - h + r}V${base}Z`}
              fill={BAR}
              fillOpacity={p.today ? 0.5 : 1}
            />
          );
        })
        : runs('value').map(run => (
          <g key={run[0][0]}>
            <path d={`${line(run)}L${run[run.length - 1][0].toFixed(1)},${base}L${run[0][0].toFixed(1)},${base}Z`} fill={BAR} fillOpacity={0.55} />
            <path d={line(run)} fill="none" strokeWidth={1} strokeLinejoin="round" stroke={BAR_LIT} strokeOpacity={0.7} />
          </g>
        ))}
      {runs('average', lively).map(run => (
        <path key={run[0][0]} d={line(run)} fill="none" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" stroke={AVERAGE} />
      ))}
    </g>
  );
});

/** The marked day: a hairline, the day's bar lit up (or a dot on the area), a dot on the average. */
const Marker = ({ point, index, slot, height, bars, top }) => {
  const { base, y, barWidth } = geometry(slot, height, top);
  const x = (index + 0.5) * slot;
  return (
    <g pointerEvents="none">
      <line x1={x} x2={x} y1={LABEL_BAND} y2={base} className="stroke-white/30" />
      {bars && point.value > 0 && (
        <rect x={x - barWidth / 2} width={barWidth} y={base - Math.max(1.5, base - y(point.value))} height={Math.max(1.5, base - y(point.value))} rx={Math.min(2, barWidth / 2)} fill={BAR_LIT} />
      )}
      {!bars && point.value != null && <circle cx={x} cy={y(point.value)} r={3} strokeWidth={2} fill={BAR_LIT} stroke={PANEL} />}
      {point.average != null && <circle cx={x} cy={y(point.average)} r={3.5} strokeWidth={2} fill={AVERAGE} stroke={PANEL} />}
    </g>
  );
};

/** What the marked day was, above the chart under the pointer, kept inside the card. */
const Tooltip = ({ metric, point, x, width }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const ref = useRef(null);
  useLayoutEffect(() => {
    const tip = ref.current;
    if (!tip) return;
    const w = tip.offsetWidth;
    tip.style.left = `${Math.min(Math.max(x - w / 2, 0), Math.max(0, width - w))}px`;
  });
  const unit = metric.kind === 'hours' ? '' : t(`admin.trends.metrics.${metric.key}.unit`, { count: point.value ?? 0 });
  let detail = null;
  if (metric.units && point.per != null) {
    const [of, per] = metric.units;
    detail = `${point.of} ${t(`admin.trends.units.${of}`, { count: point.of })} · ${point.per} ${t(`admin.trends.units.${per}`, { count: point.per })}`;
  } else if (metric.context != null && point.context != null && point.recorded) {
    detail = t(`admin.trends.metrics.${metric.key}.context`, { count: point.context });
  }
  return (
    <div
      ref={ref}
      role="tooltip"
      className="pop absolute z-20 pointer-events-none rounded-xl px-3 py-2 text-xs leading-snug whitespace-nowrap"
      style={{ bottom: 'calc(100% + 6px)', left: 0, maxWidth: Math.max(width, 140) }}
    >
      <div className="text-white/55">
        {formatDay(point.day, lang, { weekday: true })}
        {point.today && <span className="text-white/40"> · {t('admin.trends.today')}</span>}
      </div>
      {point.recorded
        ? (
          <>
            <div className="mt-0.5">
              <span className="font-semibold text-sm tabular-nums text-white">{formatValue(metric, point.value, lang)}</span>
              {unit && <span className="text-white/55"> {unit}</span>}
            </div>
            {detail && <div className="text-white/45">{detail}</div>}
            {point.average != null && (
              <div className="flex items-center gap-1.5 text-white/60">
                <span className="inline-block w-3 h-0.5 rounded-full" style={{ background: AVERAGE }} aria-hidden="true" />
                {t('admin.trends.averageShort', { value: formatValue(metric, point.average, lang) })}
              </div>
            )}
          </>
        )
        : <div className="text-white/45">{t('admin.trends.notRecorded')}</div>}
    </div>
  );
};

/** The figure for the range and how it compares; why not, when it cannot. */
const Change = ({ metric, summary, data }) => {
  const { t, i18n } = useTranslation();
  const since = recordedSince(metric, data.since);
  if (summary.change === 'new') return <span className="text-xs font-semibold text-emerald-300">{t('admin.trends.new')}</span>;
  if (summary.change == null) {
    const unrecorded = since && data.previousFrom < since;
    return <span className="text-xs text-white/30" title={unrecorded ? t('admin.trends.noCompare', { count: data.days }) : undefined}>–</span>;
  }
  const { text, direction } = formatChange(summary.change, i18n.language);
  const tone = direction > 0 ? 'text-emerald-300' : direction < 0 ? 'text-red-300' : 'text-white/50';
  return (
    <span className={`text-xs font-semibold tabular-nums whitespace-nowrap ${tone}`} title={t('admin.trends.change', { change: text, count: data.days, previous: formatValue(metric, summary.previous, i18n.language) })}>
      {text}
    </span>
  );
};

/** One metric. `onMark` is a state setter (it takes an updater): focus and blur must not undo a tap on another chart. */
const TrendCard = ({ metric, data, marked, onMark }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const wide = WIDE.has(metric.key);
  const height = wide ? HEIGHT.wide : HEIGHT.small;
  const [measure, { width }] = useMeasure();
  const points = useMemo(() => seriesOf(metric, data), [metric, data]);
  const summary = useMemo(() => summaryOf(metric, data), [metric, data]);
  const top = useMemo(() => {
    const max = Math.max(0, ...points.map(p => Math.max(p.value ?? 0, p.average ?? 0)));
    return niceMax(max, { whole: !metric.kind });
  }, [points, metric]);
  const n = points.length;
  const slot = width / Math.max(1, n);
  const bars = drawsBars(width, n);
  const index = marked?.index != null && marked.index < n ? marked.index : null;
  const label = t(`admin.trends.metrics.${metric.key}.label`);
  const spansYears = n > 0 && points[0].day.slice(0, 4) !== points[n - 1].day.slice(0, 4);

  const pick = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const i = Math.floor(((e.clientX - rect.left) / Math.max(1, rect.width)) * n);
    onMark({ index: Math.min(n - 1, Math.max(0, i)), key: metric.key });
  };
  const step = (e) => {
    const moves = { ArrowLeft: -1, ArrowRight: 1, Home: -n, End: n };
    if (!(e.key in moves)) return;
    e.preventDefault();
    const from = index ?? n - 1;
    onMark({ index: Math.min(n - 1, Math.max(0, from + moves[e.key])), key: metric.key });
  };

  return (
    <div className={`${panel} px-3.5 sm:px-4 pt-3 pb-2.5 min-w-0 ${wide ? 'col-span-2' : ''}`}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-white/55 truncate" title={t(`admin.trends.metrics.${metric.key}.hint`)}>{label}</div>
      <div className="flex items-baseline gap-x-2 flex-wrap min-h-[1.75rem] mt-0.5">
        <span className={`${wide ? 'text-2xl' : 'text-xl'} font-semibold tabular-nums tracking-[-0.02em] text-white leading-tight`}>{formatValue(metric, summary.total, lang)}</span>
        <Change metric={metric} summary={summary} data={data} />
      </div>
      <div
        ref={measure}
        data-trend-chart=""
        tabIndex={0}
        role="img"
        aria-label={`${label}: ${formatValue(metric, summary.total, lang)}`}
        className="relative mt-1.5 cursor-crosshair select-none touch-pan-y rounded outline-none focus-visible:ring-1 focus-visible:ring-white/50"
        style={{ height }}
        onPointerMove={pick}
        onPointerDown={pick}
        onPointerLeave={(e) => { if (e.pointerType === 'mouse') onMark(null); }}
        onKeyDown={step}
        onFocus={() => onMark(m => (m?.key === metric.key ? m : { index: Math.min(n - 1, m?.index ?? n - 1), key: metric.key }))}
        onBlur={() => onMark(m => (m?.key === metric.key ? null : m))}
      >
        {width > 0 && n > 0 && (
          <svg width={width} height={height} className="block overflow-visible" aria-hidden="true">
            <Plot points={points} width={width} height={height} bars={bars} top={top} topLabel={formatValue(metric.kind === 'rate' ? { ...metric, kind: null } : metric, top, lang)} />
            {index != null && <Marker point={points[index]} index={index} slot={slot} height={height} bars={bars} top={top} />}
          </svg>
        )}
        {index != null && marked.key === metric.key && <Tooltip metric={metric} point={points[index]} x={(index + 0.5) * slot} width={width} />}
      </div>
      {n > 0 && (
        <div className="flex justify-between gap-2 text-[10px] text-white/40 mt-1">
          <span>{formatDay(points[0].day, lang, { year: spansYears })}</span>
          <span>{formatDay(points[n - 1].day, lang, { year: spansYears })}</span>
        </div>
      )}
    </div>
  );
};

const AdminTrends = () => {
  const { t } = useTranslation();
  const [days, setDays] = useState(RANGES[0]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [marked, setMarked] = useState(null); // { index, key }: the day pointed at, and in which chart

  useEffect(() => {
    let active = true;
    setLoading(true);
    setMarked(null);
    getAdminTrends(days)
      .then(d => { if (active) { setData(d); setErr(null); } })
      .catch(e => { if (active) setErr(errorMessage(t, e)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [days, t]);

  // A finger has no "leave": a tap anywhere but a chart puts the marker away
  useEffect(() => {
    const away = (e) => { if (!e.target.closest?.('[data-trend-chart]')) setMarked(null); };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, []);

  const anyUnrecorded = data && TREND_METRICS.some(m => {
    const since = recordedSince(m, data.since);
    return since && data.from < since;
  });

  return (
    <section className="mt-12">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 mb-3">
        <h2 className="text-xl font-semibold tracking-[-0.015em] text-white">{t('admin.trends.title')}</h2>
        <div className="flex gap-1.5">
          {RANGES.map(d => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              aria-pressed={days === d}
              className="chip h-8 px-3 text-[13px]"
            >
              {t('admin.origins.days', { count: d })}
            </button>
          ))}
        </div>
      </div>
      <Hint className="mb-3">{t('admin.trends.hint')}</Hint>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-white/55 mb-3" aria-hidden="true">
        <span className="inline-flex items-center gap-1.5"><span className="inline-block w-2 h-2.5 rounded-t-sm" style={{ background: BAR }} />{t('admin.trends.perDay')}</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block w-3.5 h-0.5 rounded-full" style={{ background: AVERAGE }} />{t('admin.trends.average')}</span>
        {anyUnrecorded && <span className="inline-flex items-center gap-1.5"><span className="inline-block w-3 h-2.5 rounded-sm bg-white/[0.06] border border-white/10" />{t('admin.trends.notRecorded')}</span>}
      </div>
      {err && <Notice tone="error" className="mb-3">{err}</Notice>}
      {!data
        ? (loading && <Loading>{t('sections.loading')}</Loading>)
        : (
          <div className={`grid grid-cols-2 xl:grid-cols-4 gap-2 sm:gap-3 transition-opacity ${loading ? 'opacity-50' : ''}`}>
            {TREND_METRICS.map(m => <TrendCard key={m.key} metric={m} data={data} marked={marked} onMark={setMarked} />)}
          </div>
        )}
    </section>
  );
};

export default AdminTrends;
