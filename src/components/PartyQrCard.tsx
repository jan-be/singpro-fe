import React, { useId } from "react";
import { useTranslation } from "react-i18next";
import { QRCodeSVG } from "qrcode.react";
import Avatar from "./Avatar";
import { LockIcon } from "./Icons";
import { playerHue } from "../logic/playerColor";

/**
 * The enlarged QR code of the party bar: the code to scan and the link to
 * copy, on white so a phone across the room reads it. While joining is
 * closed they say so, for everyone (a phone held up to a newcomer too).
 *
 * The host and co-hosts get the party's door underneath: the switch for
 * joining by the code or the link, and everyone in the party with a co-host
 * switch (people from cardPeople, logic/partyRoles.js). The host's own role
 * has no switch: nobody takes it.
 */
const PartyQrCard = ({ qrUrl, joinUrl, linkUrl, joiningOpen = true, controls = false, people = [], playerAvatars, playerColors, onSetCohost, onSetJoiningOpen }) => {
  const { t } = useTranslation();
  const labelId = useId(); // the bar renders the card twice (laptop and phone layout), one of them hidden
  const code = (
    <>
      <div className="relative">
        <QRCodeSVG value={qrUrl} size={168} className={joiningOpen ? undefined : 'opacity-[0.12]'} />
        {!joiningOpen && (
          <span className="absolute inset-0 grid place-items-center text-ink"><LockIcon size={46} strokeWidth={1.8} /></span>
        )}
      </div>
      {joiningOpen ? (
        <div className="text-gray-900 font-mono text-sm text-center break-all select-all leading-tight">{joinUrl}</div>
      ) : (
        <div className="text-center leading-tight max-w-[13rem]" data-joining-closed="">
          <div className="text-gray-900 font-semibold text-sm">{t('party.joiningClosed')}</div>
          <div className="mt-1 text-gray-500 text-xs leading-snug">{t('party.joiningClosedHint')}</div>
        </div>
      )}
      <button
        type="button"
        onClick={() => { navigator.clipboard.writeText(linkUrl); }}
        disabled={!joiningOpen}
        className="btn btn-sm bg-ink text-white hover:bg-black"
      >
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="9" y="9" width="13" height="13" rx="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
        {t('party.copyLink')}
      </button>
    </>
  );

  if (!controls) {
    return (
      <div className="absolute top-full right-0 mt-2.5 bg-white rounded-2xl p-5 shadow-[0_24px_60px_-16px_rgba(0,0,0,0.85)] flex flex-col items-center gap-3 z-50" style={{ minWidth: 220 }}>
        {code}
      </div>
    );
  }

  return (
    // A popover with the white code on top; scrolls when a phone held sideways has no room for it all
    <div className="pop absolute top-full right-0 mt-2.5 p-2 z-50 w-[17.5rem] max-h-[calc(100dvh-5rem)] overflow-y-auto overscroll-contain" data-party-door="">
      <div className="bg-white rounded-[0.9rem] p-4 flex flex-col items-center gap-3">
        {code}
      </div>
      <div className="px-2 pt-3 pb-1">
        <div className="flex items-center justify-between gap-3">
          <span id={labelId} className="text-sm font-medium text-white">{t('party.joiningSwitch')}</span>
          <button
            type="button"
            role="switch"
            aria-checked={joiningOpen}
            aria-labelledby={labelId}
            data-joining-switch=""
            onClick={() => onSetJoiningOpen?.(!joiningOpen)}
            className="switch"
          />
        </div>

        <div className="pop-label mt-4">{t('party.cohosts')}</div>
        <p className="mt-1 text-xs text-white/55 leading-snug">{t('party.cohostsHint')}</p>
        <ul className="mt-1.5" aria-label={t('party.cohosts')}>
          {people.map(p => (
            <li key={p.name} className="flex items-center gap-2.5 py-1.5" data-person={p.name}>
              <Avatar username={p.name} src={playerAvatars?.[p.name]} hue={playerHue(playerColors, p.name)} size={26} className={p.away ? 'opacity-50' : ''} />
              <span className={`flex-1 min-w-0 truncate text-sm ${p.away ? 'text-white/50' : 'text-white'}`}>
                {p.name}
                {p.me && <span className="text-white/45"> · {t('queue.you')}</span>}
                {p.away && <span className="text-white/40"> · {t('party.away')}</span>}
              </span>
              {p.host ? (
                <span className="text-xs font-semibold text-white/55 pr-0.5">{t('party.hostRole')}</span>
              ) : (
                <button
                  type="button"
                  role="switch"
                  aria-checked={p.cohost}
                  aria-label={t('party.cohostSwitch', { name: p.name })}
                  title={t('party.cohostSwitch', { name: p.name })}
                  onClick={() => onSetCohost?.(p.name, !p.cohost)}
                  className="switch"
                />
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

export default PartyQrCard;
