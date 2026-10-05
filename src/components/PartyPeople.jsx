import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Avatar from './Avatar';
import ReportPicture from './ReportPicture';
import { playerHue } from '../logic/playerColor';

const SHOWN = 8;

/**
 * Who is in the party right now: their avatars side by side (pictures, or
 * letters on their colours), you first, then in the order they came; past
 * eight a "+n". The names are in each avatar's tooltip and for screen readers.
 * Someone else's picture opens larger underneath on a tap, with "Report
 * picture" (inline: the queue panel clips anything that would float).
 */
const PartyPeople = ({ members = [], playerAvatars, playerColors, currentUserName, partyId, size = 28 }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(null); // the username whose picture is shown larger
  if (members.length === 0) return null;
  const ordered = members.includes(currentUserName) ? [currentUserName, ...members.filter(m => m !== currentUserName)] : members;
  const shown = ordered.slice(0, SHOWN);
  const more = ordered.length - shown.length;
  const openPicture = open && open !== currentUserName && members.includes(open) ? playerAvatars?.[open] : null;
  return (
    <div data-testid="party-people">
      <div className="flex items-center gap-2.5 min-w-0">
        <ul className="flex items-center flex-shrink-0" aria-label={t('party.people')}>
          {shown.map((name, i) => {
            const title = name === currentUserName ? `${name} (${t('queue.you')})` : name;
            const avatar = <Avatar username={name} src={playerAvatars?.[name]} hue={playerHue(playerColors, name)} size={size} />;
            const canOpen = name !== currentUserName && Boolean(playerAvatars?.[name]);
            return (
              <li key={name} title={title} className={`rounded-full ring-2 ring-[#251e48] ${i ? '-ml-1.5' : ''}`} style={{ zIndex: SHOWN - i }}>
                {canOpen ? (
                  <button type="button" onClick={() => setOpen(o => (o === name ? null : name))} aria-expanded={open === name} className="block rounded-full">
                    {avatar}
                    <span className="sr-only">{name}</span>
                  </button>
                ) : (
                  <>
                    {avatar}
                    <span className="sr-only">{name}</span>
                  </>
                )}
              </li>
            );
          })}
          {more > 0 && (
            <li className="-ml-1.5 rounded-full ring-2 ring-[#251e48] bg-white/[0.12] text-white/80 text-[11px] font-semibold tabular-nums grid place-items-center" style={{ width: size, height: size }} title={ordered.slice(SHOWN).join(', ')}>
              +{more}
            </li>
          )}
        </ul>
        <span className="text-xs text-white/55 truncate">
          {t('party.people')} <span className="tabular-nums text-white/40">· {members.length}</span>
        </span>
      </div>
      {openPicture && (
        <div className="flex items-start gap-3 mt-2.5 p-2.5 rounded-xl bg-white/[0.05] ring-1 ring-inset ring-white/[0.08]" data-testid="party-person">
          <Avatar username={open} src={openPicture} hue={playerHue(playerColors, open)} size={64} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-white truncate">{open}</span>
              <button type="button" onClick={() => setOpen(null)} className="btn-icon w-7 h-7 text-white/55 text-xs" aria-label={t('avatar.close')}>&#10005;</button>
            </div>
            <ReportPicture path={openPicture} where={{ place: 'party', partyId, nickname: currentUserName }} className="mt-1" />
          </div>
        </div>
      )}
    </div>
  );
};

export default PartyPeople;
