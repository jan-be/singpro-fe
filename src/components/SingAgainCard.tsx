import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { apiUrl } from "../GlobalConsts";
import { trackPick } from "../logic/track";
import { lastHostedParty, leftoverParty, missedSongs, isLongParty, dismissParty, savePendingQueue } from "../logic/partyHistory";
import { parseAgain, planUrl, nextSameTime, toLocalInput, fromLocalInput, icsEvent, downloadIcs } from "../logic/partyPlan";
import { useInstallMode, promptInstall } from "../logic/installPrompt";

/** A song to start again with: a song card of a ?again link, or a song of a past party (logic/partyHistory.js) */
interface AgainSong {
  songId: string;
}

/** A party this browser hosted (logic/partyHistory.js), what NextTime reads of it */
interface HostedParty {
  partyId: string;
  /** ms */
  startedAt: number;
  songs: AgainSong[];
}

export interface SingAgainCardProps {
  /** a long party just ended: the home screen and calendar links */
  justEnded?: boolean;
}

interface QuietBarProps {
  text: string;
  action: string;
  onAction: () => void;
  onClose: () => void;
  closeLabel: string;
}

/** One quiet line: what is left, one action, its ✕ */
const QuietBar = ({ text, action, onAction, onClose, closeLabel }: QuietBarProps) => (
  <div className="relative mt-4 max-w-md mx-auto flex items-center gap-1 rounded-2xl border border-white/[0.08] bg-white/[0.03] pl-4 pr-1 py-1 text-[13px] text-white/60 text-left">
    <span className="flex-1 min-w-0 text-pretty py-1">{text}</span>
    <button type="button" onClick={onAction} className="flex-shrink-0 h-8 px-3 rounded-full font-medium text-white/85 hover:text-white hover:bg-white/10 transition-colors cursor-pointer">
      {action}
    </button>
    <button type="button" onClick={onClose} className="btn-icon w-8 h-8 text-white/35" aria-label={closeLabel} title={closeLabel}>✕</button>
  </div>
);

/** Right after a long party: SingSpree on the home screen, and the next party in the calendar (small links) */
function NextTime({ party }: { party: HostedParty }) {
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
      uid: `${party.startedAt}-${party.partyId}@singspree.com`,
    }));
  };
  const link = 'text-white/70 hover:text-white underline decoration-white/25 underline-offset-4 cursor-pointer';
  return (
    <div className="relative mt-3 max-w-md mx-auto text-[13px] text-white/45 text-pretty">
      {t('again.nextTime')}{' '}
      {install === 'prompt' && <><button type="button" className={link} onClick={() => promptInstall()}>{t('again.addToHomeScreen')}</button>{' · '}</>}
      {install === 'ios' && <><button type="button" className={link} aria-expanded={iosHint} onClick={() => setIosHint(v => !v)}>{t('again.addToHomeScreen')}</button>{' · '}</>}
      <button type="button" className={link} aria-expanded={planning} onClick={() => setPlanning(v => !v)}>{t('again.planNext')}</button>
      {iosHint && <p className="mt-2 text-white/60">{t('again.iosHint')}</p>}
      {planning && (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          <label className="flex items-center gap-2 text-white/55">
            {t('again.when')}
            <input
              type="datetime-local"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
              style={{ colorScheme: 'dark' }}
              className="h-8 rounded-lg bg-white/[0.06] border border-white/12 px-2 text-white text-[13px]"
            />
          </label>
          <button type="button" className="btn btn-ghost btn-sm" onClick={addToCalendar}>{t('again.addToCalendar')}</button>
        </div>
      )}
    </div>
  );
}

/**
 * Below the entry page's hero, rarely and quietly:
 *  - a calendar entry's link (?again=…): its songs, started in one click;
 *  - the last party this browser hosted left several songs unsung
 *    (logic/partyHistory.js leftoverParty): sing those, or ✕ for good;
 *  - right after a long party ended (`justEnded`): home screen and calendar links.
 */
export default function SingAgainCard({ justEnded = false }: SingAgainCardProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const againParam = params.get('again');
  const planIds = useMemo(() => parseAgain(againParam), [againParam]);
  const [plan, setPlan] = useState<AgainSong[] | null>(null); // the songs of a ?again link
  const [leftover, setLeftover] = useState(() => leftoverParty());
  const [ended] = useState(() => (justEnded ? lastHostedParty() : null));

  useEffect(() => {
    if (!planIds.length) { setPlan(null); return undefined; }
    let gone = false;
    fetch(`${apiUrl}/song-cards?ids=${planIds.join('.')}`)
      .then(r => r.json())
      .then(j => { if (!gone) setPlan(j.data?.length ? j.data : null); })
      .catch(() => {});
    return () => { gone = true; };
  }, [planIds]);

  const start = (list: AgainSong[]) => {
    const [first, ...rest] = list;
    savePendingQueue(rest);
    trackPick('sing-again', { songId: first.songId, position: 0 });
    navigate(`/sing/${first.songId}`);
  };

  if (plan) {
    const close = () => {
      const next = new URLSearchParams(params);
      next.delete('again');
      setParams(next, { replace: true });
      setPlan(null);
    };
    return (
      <QuietBar
        text={`${t('again.plan')} · ${t('again.songs', { count: plan.length })}`}
        action={t('again.start')} onAction={() => start(plan)}
        onClose={close} closeLabel={t('again.close')}
      />
    );
  }

  const missed = leftover ? missedSongs(leftover) : [];
  return (
    <>
      {justEnded && ended && isLongParty(ended) && <NextTime party={ended} />}
      {leftover && (
        <QuietBar
          text={t('again.leftover', { count: missed.length })}
          action={t('again.singThem')} onAction={() => start(missed)}
          onClose={() => { dismissParty(leftover.partyId, leftover.startedAt); setLeftover(null); }}
          closeLabel={t('forYou.hide')}
        />
      )}
    </>
  );
}
