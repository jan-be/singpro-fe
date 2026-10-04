import React from 'react';

/**
 * The admin console's building blocks (tiles, sections, badges, thumbnails,
 * buttons), shared by AdminPage.jsx and the sections that live in their own
 * file (AdminChartJobs.jsx, AdminTrends.jsx), so all of /admin looks alike.
 */

export const btn = {
  primary: 'px-3 py-1.5 rounded-lg bg-neon-cyan/10 text-neon-cyan border border-neon-cyan/40 hover:bg-neon-cyan/20 hover:border-neon-cyan text-sm font-semibold transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed',
  quiet: 'px-3 py-1.5 rounded-lg bg-surface-lighter/60 text-gray-300 border border-surface-lighter hover:text-white hover:border-gray-500 text-sm transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed',
  danger: 'px-3 py-1.5 rounded-lg bg-surface-lighter/60 text-gray-400 border border-surface-lighter hover:text-red-400 hover:bg-red-500/10 hover:border-red-500/40 text-sm transition-all cursor-pointer disabled:opacity-40',
};

export const StatTile = ({ label, value, accent, small }) => (
  <div className="rounded-xl bg-surface-light border border-surface-lighter px-4 py-3 text-center">
    <div className={`${small ? 'text-lg' : 'text-2xl'} font-black font-mono leading-tight ${accent ?? 'text-white'}`}>{value}</div>
    <div className="text-xs text-gray-400 mt-0.5">{label}</div>
  </div>
);

export const Section = ({ title, children, aside }) => (
  <section className="mt-8">
    <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
      <h2 className="text-lg font-bold text-white">{title}</h2>
      {aside}
    </div>
    {children}
  </section>
);

const TONES = {
  gray: 'border-surface-lighter text-gray-400',
  cyan: 'border-neon-cyan/50 text-neon-cyan',
  green: 'border-neon-green/50 text-neon-green',
  magenta: 'border-neon-magenta/50 text-neon-magenta',
  yellow: 'border-yellow-400/50 text-yellow-400',
  red: 'border-red-400/50 text-red-400',
};
export const Badge = ({ tone = 'gray', children }) => (
  <span className={`inline-block rounded-full border px-1.5 py-px text-[10px] uppercase tracking-wider whitespace-nowrap ${TONES[tone] ?? TONES.gray}`}>{children}</span>
);

export const Thumb = ({ videoId }) => (videoId
  ? <img src={`https://i.ytimg.com/vi/${videoId}/default.jpg`} alt="" className="w-14 h-10 rounded object-cover flex-shrink-0 bg-surface-lighter" loading="lazy" />
  : <div className="w-14 h-10 rounded bg-surface-lighter flex-shrink-0" />);

/** Filter buttons in a row (a section's status filter), each with its count when known */
export const FilterButtons = ({ options, value, onChange, label, counts }) => (
  <div className="flex flex-wrap gap-1">
    {options.map(o => (
      <button
        key={o}
        type="button"
        aria-pressed={value === o}
        onClick={() => onChange(o)}
        className={`px-2 py-1 rounded-md text-xs border cursor-pointer transition-colors ${value === o ? 'border-neon-cyan text-neon-cyan bg-neon-cyan/10' : 'border-surface-lighter text-gray-400 hover:text-white'}`}
      >
        {label(o)}{counts ? ` (${counts[o] ?? 0})` : ''}
      </button>
    ))}
  </div>
);
