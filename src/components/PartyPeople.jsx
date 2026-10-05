import React from 'react';
import { useTranslation } from 'react-i18next';
import Avatar from './Avatar';
import { playerHue } from '../logic/playerColor';

const SHOWN = 8;

/**
 * Who is in the party right now: their avatars side by side (pictures, or
 * letters on their colours), you first, then in the order they came; past
 * eight a "+n". The names are in each avatar's tooltip and for screen readers.
 */
const PartyPeople = ({ members = [], playerAvatars, playerColors, currentUserName, size = 28 }) => {
  const { t } = useTranslation();
  if (members.length === 0) return null;
  const ordered = members.includes(currentUserName) ? [currentUserName, ...members.filter(m => m !== currentUserName)] : members;
  const shown = ordered.slice(0, SHOWN);
  const more = ordered.length - shown.length;
  return (
    <div className="flex items-center gap-2.5 min-w-0" data-testid="party-people">
      <ul className="flex items-center flex-shrink-0" aria-label={t('party.people')}>
        {shown.map((name, i) => (
          <li key={name} title={name === currentUserName ? `${name} (${t('queue.you')})` : name} className={`rounded-full ring-2 ring-[#251e48] ${i ? '-ml-1.5' : ''}`} style={{ zIndex: SHOWN - i }}>
            <Avatar username={name} src={playerAvatars?.[name]} hue={playerHue(playerColors, name)} size={size} />
            <span className="sr-only">{name}</span>
          </li>
        ))}
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
  );
};

export default PartyPeople;
