import React from 'react';

/**
 * The admin console's building blocks (tiles, sections, badges, thumbnails,
 * buttons), shared by AdminPage.jsx and the sections that live in their own
 * file (AdminChartJobs.jsx, AdminTrends.jsx), so all of /admin looks alike.
 */

export const btn = {
  primary: 'btn btn-sm btn-primary',
  quiet: 'btn btn-sm btn-ghost',
  danger: 'btn btn-sm btn-stop',
};

/** A panel on the stage: the cards, lists and tiles of /admin */
export const panel = 'rounded-2xl bg-panel border border-white/10';

/** A list in one panel, rows parted by hairlines */
export const list = `${panel} divide-y divide-white/[0.07] overflow-hidden`;

/** Loading line, as the front page's */
export const Loading = ({ children }) => <div className="text-white/40 text-sm text-center py-6 animate-pulse">{children}</div>;

/** A soft note under a heading: green when something worked, red when it did not */
export const Notice = ({ tone = 'ok', className = '', children }) => (
  <div
    role={tone === 'ok' ? 'status' : 'alert'}
    className={`rounded-xl border px-3.5 py-2 text-sm ${tone === 'ok' ? 'bg-emerald-400/10 border-emerald-400/20 text-emerald-200' : 'bg-red-500/10 border-red-400/25 text-red-200'} ${className}`}
  >
    {children}
  </div>
);

/**
 * A number with its name. `accent` (a text colour class) lights the small dot
 * before the name; `warn` turns the number itself red (a limit reached).
 */
export const StatTile = ({ label, value, accent, small, warn }) => (
  <div className={`${panel} px-4 py-3 min-w-0`}>
    <div className="flex items-center gap-1.5 text-xs text-white/55 min-w-0">
      {accent && <span className={`w-1.5 h-1.5 rounded-full bg-current flex-shrink-0 ${accent}`} aria-hidden="true" />}
      <span className="truncate" title={label}>{label}</span>
    </div>
    <div className={`${small ? 'text-lg mt-1.5' : 'text-2xl mt-1'} font-semibold tabular-nums tracking-[-0.02em] leading-tight ${warn ? 'text-red-300' : 'text-white'}`}>{value}</div>
  </div>
);

export const Section = ({ title, children, aside }) => (
  <section className="mt-12">
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 mb-3">
      <h2 className="text-xl font-semibold tracking-[-0.015em] text-white">{title}</h2>
      {aside}
    </div>
    {children}
  </section>
);

/** A section's explanation under its heading */
export const Hint = ({ className = 'mb-4', children }) => (
  <p className={`text-[13px] leading-relaxed text-white/50 max-w-3xl ${className}`}>{children}</p>
);

const TONES = {
  gray: 'bg-white/10 text-white/65',
  cyan: 'bg-cyan-400/15 text-cyan-200',
  green: 'bg-emerald-400/15 text-emerald-300',
  magenta: 'bg-hot/15 text-pink-300',
  yellow: 'bg-amber-400/15 text-amber-300',
  red: 'bg-red-500/15 text-red-300',
};
export const Badge = ({ tone = 'gray', children }) => (
  <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider leading-tight whitespace-nowrap ${TONES[tone] ?? TONES.gray}`}>{children}</span>
);

export const Thumb = ({ videoId }) => (videoId
  ? <img src={`https://i.ytimg.com/vi/${videoId}/default.jpg`} alt="" className="w-14 h-10 rounded-lg object-cover flex-shrink-0 bg-white/[0.06] ring-1 ring-inset ring-white/10" loading="lazy" />
  : <div className="w-14 h-10 rounded-lg bg-white/[0.06] flex-shrink-0" />);

/** Filter chips in a row (a section's status filter), each with its count when known */
export const FilterButtons = ({ options, value, onChange, label, counts }) => (
  <div className="flex flex-wrap gap-1.5">
    {options.map(o => (
      <button
        key={o}
        type="button"
        aria-pressed={value === o}
        onClick={() => onChange(o)}
        className="chip h-8 px-3 text-[13px]"
      >
        {label(o)}{counts ? ` (${counts[o] ?? 0})` : ''}
      </button>
    ))}
  </div>
);
