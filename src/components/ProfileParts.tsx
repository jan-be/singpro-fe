import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * What the profile (pages/ProfilePage.tsx) and your settings
 * (pages/SettingsPage.tsx) share: their buttons, fields, sections and the
 * second click that deletes.
 */

/** A line under a panel: what worked, or `error` */
export type Note = { text: string; error?: boolean };

export const useDate = () => {
  const { i18n } = useTranslation();
  return (d: string | null) => (d ? new Date(d).toLocaleDateString(i18n.language, { year: 'numeric', month: 'short', day: 'numeric' }) : '');
};

// Row and header buttons: the main action filled, the rest quiet; removing turns red only on hover
export const btn = {
  primary: 'btn btn-primary no-underline',
  quiet: 'btn btn-ghost no-underline',
  danger: 'btn btn-ghost hover:text-red-300 hover:bg-red-500/10 hover:border-red-400/30',
};
export const sm = (cls: string) => `${cls} btn-sm`;
export const input = 'field h-10 px-4 text-sm';
// A list in a panel: hairline rows on violet
export const listBox = 'rounded-2xl bg-panel border border-white/10 divide-y divide-white/[0.07] overflow-hidden';
export const rowBox = 'flex items-center justify-between gap-3 px-4 py-2.5';
// The page's header card, with a stage light from the top left like the page behind it
export const headerCard = 'relative overflow-hidden rounded-3xl bg-panel border border-white/10 shadow-[0_24px_60px_-24px_rgba(0,0,0,0.8)] p-5 sm:p-7 flex flex-wrap items-center gap-4 sm:gap-6';
export const stageLight = 'absolute inset-0 pointer-events-none bg-[radial-gradient(520px_240px_at_0%_0%,rgba(255,79,216,0.18),transparent_70%)]';

export const TrashIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
  </svg>
);

export const Section = ({ id, title, children, aside }: { id?: string; title: React.ReactNode; children?: React.ReactNode; aside?: React.ReactNode }) => (
  <section id={id} className="mt-10 scroll-mt-20">
    <div className="flex items-center justify-between gap-3 mb-3 min-h-8">
      <h2 className="text-lg font-semibold tracking-[-0.02em] text-white">{title}</h2>
      {aside}
    </div>
    {children}
  </section>
);

/**
 * A button that deletes asks for a second click within 3 seconds (as the
 * queue's skip does), instead of the browser's confirm box: `armed` while it
 * waits; press(fn) arms it, or runs fn when armed.
 */
export const useSecondClick = (ms = 3000) => {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(false), ms);
    return () => clearTimeout(id);
  }, [armed, ms]);
  return { armed, press: (fn: () => void) => { if (armed) { setArmed(false); fn(); } else setArmed(true); } };
};
