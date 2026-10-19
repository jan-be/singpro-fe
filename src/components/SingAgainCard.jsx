import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { apiUrl } from "../GlobalConsts";
import { trackPick } from "../logic/track";
import {
  lastHostedParty, missedSongs, otherSingers, isLongParty, forgetParty, savePendingQueue,
} from "../logic/partyHistory";
import { parseAgain, planUrl, nextSameTime, toLocalInput, fromLocalInput, icsEvent, downloadIcs } from "../logic/partyPlan";
import { useInstallMode, promptInstall } from "../logic/installPrompt";

/** The extras ("next time in one tap") follow a long party for this long */
const EXTRAS_FOR_MS = 24 * 3600 * 1000;

/** "today", "yesterday", else the weekday and date, in the page's language */
function partyDate(at, lang, now = Date.now()) {
  const day = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const days = Math.round((day(now) - day(at)) / 86_400_000);
  try {
    if (days >= 0 && days <= 1) return new Intl.RelativeTimeFormat(lang, { numeric: 'auto' }).format(-days, 'day');
    return new Intl.DateTimeFormat(lang, { weekday: 'short', day: 'numeric', month: 'short' }).format(at);
  } catch {
    return new Date(at).toLocaleDateString();
  }
}

/** "Anna, Ben and Carl", more than three as "+2" */
function nameList(names, lang) {
  const shown = names.length > 3 ? [...names.slice(0, 3), `+${names.length - 3}`] : names;
  try { return new Intl.ListFormat(lang, { style: 'long', type: 'conjunction' }).format(shown); } catch { return shown.join(', '); }
}

const Thumbs = ({ songs }) => (
  <div className="relative flex-shrink-0 w-[96px] h-12" aria-hidden="true">
    {songs.slice(0, 3).map((s, i) => (
      <div
        key={s.songId}
        className="absolute top-0 h-12 w-16 overflow-hidden rounded-lg bg-[#2a2350] ring-1 ring-white/15 shadow-[4px_0_10px_-4px_rgba(0,0,0,0.7)]"
        style={{ left: i * 16, zIndex: 3 - i, filter: i ? `brightness(${1 - i * 0.25})` : undefined }}
      >
        {s.videoId && <img src={`https://i.ytimg.com/vi/${s.videoId}/mqdefault.jpg`} alt="" className="w-full h-full object-cover" loading="lazy" />}
      </div>
    ))}
  </div>
);

/** After a long party: SingPro on the home screen, and the next party in the calendar */
function NextTime({ party }) {
  const { t } = useTranslation();
  const install = useInstallMode();
  const [iosHint, setIosHint] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [when, setWhen] = useState(() => toLocalInput(nextSameTime(party.startedAt)));
  const addToCalendar = () => {
    const start = fromLocalInput(when) ?? nextSameTime(party.startedAt);
    const url = planUrl(window.location.origin, party.songs);
    downloadIcs(icsEvent({
      start, url,
      title: t('again.calendarTitle'),
      description: t('again.calendarText', { url }),
      uid: `${party.startedAt}-${party.partyId}@singpro.app`,
    }));
  };
  return (
    <div className="mt-3 pt-3 border-t border-white/[0.08]">
      <div className="text-white/55 text-[13px] mb-2">{t('again.nextTime')}</div>
      <div className="flex flex-wrap gap-2">
        {install === 'prompt' && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => promptInstall()}>{t('again.addToHomeScreen')}</button>
        )}
        {install === 'ios' && (
          <button type="button" className="btn btn-ghost btn-sm" aria-expanded={iosHint} onClick={() => setIosHint(v => !v)}>{t('again.addToHomeScreen')}</button>
        )}
        <button type="button" className="btn btn-ghost btn-sm" aria-expanded={planning} onClick={() => setPlanning(v => !v)}>{t('again.planNext')}</button>
      </div>
      {iosHint && <p className="mt-2 text-[13px] text-white/70 text-pretty">{t('again.iosHint')}</p>}
      {planning && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-[13px] text-white/60">
            {t('again.when')}
            <input
              type="datetime-local"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
              style={{ colorScheme: 'dark' }}
              className="h-8 rounded-lg bg-white/[0.08] border border-white/15 px-2 text-white text-[13px]"
            />
          </label>
          <button type="button" className="btn btn-primary btn-sm" onClick={addToCalendar}>{t('again.addToCalendar')}</button>
        </div>
      )}
    </div>
  );
}

/**
 * The entry page's "Your last party" for a host who comes back: the songs of
 * the last party this browser hosted (logic/partyHistory.js), or of a
 * calendar entry's link (?again=…), started again in one click. Hidden with
 * the ✕, which forgets that party on this browser.
 */
export default function SingAgainCard() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const againParam = params.get('again');
  const planIds = useMemo(() => parseAgain(againParam), [againParam]);
  const [plan, setPlan] = useState(null); // the songs of a ?again link
  const [party, setParty] = useState(() => lastHostedParty());

  useEffect(() => {
    if (!planIds.length) { setPlan(null); return undefined; }
    let gone = false;
    fetch(`${apiUrl}/song-cards?ids=${planIds.join('.')}`)
      .then(r => r.json())
      .then(j => { if (!gone) setPlan(j.data?.length ? j.data : null); })
      .catch(() => {});
    return () => { gone = true; };
  }, [planIds]);

  const songs = plan ?? party?.songs ?? [];
  if (!songs.length) return null;
  const missed = plan ? [] : missedSongs(party);
  const singers = plan ? [] : otherSingers(party);
  const extras = !plan && isLongParty(party) && Date.now() - party.lastAt < EXTRAS_FOR_MS;

  const start = (list) => {
    const [first, ...rest] = list;
    savePendingQueue(rest);
    trackPick('sing-again', { songId: first.songId, position: 0 });
    navigate(`/sing/${first.songId}`);
  };
  const dismiss = () => {
    if (plan) {
      const next = new URLSearchParams(params);
      next.delete('again');
      setParams(next, { replace: true });
      setPlan(null);
      return;
    }
    forgetParty(party.partyId, party.startedAt);
    setParty(null);
  };

  const details = [
    t('again.songs', { count: songs.length }),
    singers.length ? t('again.with', { names: nameList(singers, i18n.language) }) : null,
  ].filter(Boolean).join(' · ');

  return (
    <div className="relative mt-6 max-w-lg mx-auto rounded-2xl bg-panel border border-white/10 p-3 sm:p-4 text-left">
      <div className="flex items-start gap-3">
        <Thumbs songs={songs} />
        <div className="min-w-0 flex-1">
          <div className="text-white text-[15px] font-semibold leading-snug">
            {plan ? t('again.plan') : t('again.lastParty', { date: partyDate(party.startedAt, i18n.language) })}
          </div>
          <div className="text-white/55 text-[13px] leading-snug mt-0.5 line-clamp-2">{details}</div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="btn-icon w-8 h-8 -mr-1 -mt-1 text-white/45"
          aria-label={plan ? t('again.close') : t('again.forget')}
          title={plan ? t('again.close') : t('again.forget')}
        >
          ✕
        </button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary btn-sm" onClick={() => start(songs)}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z" /></svg>
          {t('again.start')}
        </button>
        {missed.length > 0 && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => start(missed)}>
            {t('again.missed', { count: missed.length })}
          </button>
        )}
      </div>
      {extras && <NextTime party={party} />}
    </div>
  );
}
