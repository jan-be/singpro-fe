import React, { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useSongNames } from "../logic/useSongNames";
import QueuePanel from "./QueuePanel";
import SimilarSongs from "./SimilarSongs";
import { PopOutIcon, PopInIcon } from "./Icons";
import { hueToCss, playerHue } from "../logic/playerColor";
import Wordmark from "./Wordmark";
import AiBadge from "./AiBadge";

// Past this many, the singers line ends in "+N more" (a crowd party has hundreds)
const MAX_SINGER_CHIPS = 12;

const windowButtonClass = "btn btn-sm h-7 px-2.5 gap-1.5 text-xs font-medium flex-shrink-0 bg-white/[0.07] text-white/80 hover:bg-white/[0.12] hover:text-white";

/** The drawer's button that moves the queue into a window of its own. */
export const PopOutButton = ({ onClick }) => {
  const { t } = useTranslation();
  return (
    <button type="button" onClick={onClick} title={t('queue.popOutHint')} className={windowButtonClass}>
      <PopOutIcon size={13} />
      {t('queue.popOut')}
    </button>
  );
};

const NowPlaying = ({ song, singers, playerColors }) => {
  const { t } = useTranslation();
  const names = useSongNames()(song);
  const shown = singers.slice(0, MAX_SINGER_CHIPS);
  return (
    <section className="pop p-3.5" aria-label={t('queue.nowPlaying')}>
      <div className="flex items-center gap-3">
        {song.videoId && (
          <div className="relative flex-shrink-0">
            <img
              src={`https://i.ytimg.com/vi/${song.videoId}/mqdefault.jpg`}
              alt=""
              className="block w-20 sm:w-24 aspect-video rounded-lg object-cover"
            />
            {song.generated && <AiBadge />}
          </div>
        )}
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-neon-green font-bold">{t('queue.nowPlaying')}</div>
          <div className="text-white font-semibold truncate" lang={names.lang}>{names.title}</div>
          <div className="text-white/55 text-xs truncate" lang={names.lang}>{names.artist}</div>
        </div>
      </div>
      {singers.length > 0 && (
        <div className="mt-3">
          <div className="pop-label text-[10px] mb-1.5">{t('queue.singing')}</div>
          <ul className="flex flex-wrap gap-1.5">
            {shown.map(name => (
              <li key={name} className="inline-flex items-center gap-1.5 max-w-full px-2 py-0.5 rounded-full bg-white/[0.07] ring-1 ring-inset ring-white/[0.1] text-xs text-white/85">
                <span aria-hidden="true" className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: hueToCss(playerHue(playerColors, name)) }} />
                <span className="truncate">{name}</span>
              </li>
            ))}
            {singers.length > shown.length && (
              <li className="px-1 py-0.5 text-xs text-white/50">{t('queue.moreSingers', { count: singers.length - shown.length })}</li>
            )}
          </ul>
        </div>
      )}
    </section>
  );
};

/**
 * The queue in a window of its own (see popoutWindow.js), for a laptop screen
 * while the party page plays fullscreen on the TV. The party page renders it
 * through a portal, so it shows the page's own state and its buttons call the
 * page's own handlers: whatever the queue drawer can do, this can too.
 *
 * song: { title, artist, videoId } of the current song, or null
 * singers: usernames of who is singing this song
 * onDock: close the window and show the queue in the party window again
 */
const QueueWindow = ({
  partyId, song, singers = [], playerColors,
  queue, isHost, currentUserName, onAdd, onAddJob, onRemove, onReorder, onSkip,
  similarSongs, onDock,
}) => {
  const { t, i18n } = useTranslation();
  const rootRef = useRef(null);

  // The window's title (with the queue length, for the taskbar) and language
  const title = `${t('queue.title')}${queue.length ? ` (${queue.length})` : ''} · singpro.app`;
  useEffect(() => {
    const doc = rootRef.current?.ownerDocument;
    if (!doc) return;
    doc.title = title;
    doc.documentElement.lang = i18n.language;
  }, [title, i18n.language]);

  return (
    <div ref={rootRef} className="min-h-dvh flex flex-col text-sm">
      <header className="sticky top-0 z-10 flex items-center gap-3 px-3 sm:px-4 py-2 bg-stage/95 border-b border-white/[0.08]">
        <span className="flex items-center flex-shrink-0">
          <Wordmark height={28} className="-my-1.5" />
        </span>
        {partyId && (
          <span className="ml-auto flex items-baseline gap-2 min-w-0">
            <span className="hidden min-[400px]:inline text-white/45 text-[9.5px] font-semibold uppercase tracking-[0.14em] truncate">{t('bottom.partyCode')}</span>
            <span className="text-neon-cyan font-mono font-semibold tracking-[0.2em]">{partyId}</span>
          </span>
        )}
      </header>

      {/* One column in a narrow window; from md the queue gets the left and
          the current song and the suggestions stack on the right */}
      <main className="flex-1 w-full max-w-5xl mx-auto p-3 sm:p-4 grid gap-3 sm:gap-4 content-start md:grid-cols-[minmax(0,1fr)_minmax(0,20rem)] md:items-start">
        {song && (
          <div className="min-w-0 md:col-start-2 md:row-start-1">
            <NowPlaying song={song} singers={singers} playerColors={playerColors} />
          </div>
        )}
        <div className="min-w-0 md:col-start-1 md:row-start-1 md:row-span-2">
          <QueuePanel
            queue={queue}
            isHost={isHost}
            currentUserName={currentUserName}
            playerColors={playerColors}
            onAdd={onAdd}
            onAddJob={onAddJob}
            onRemove={onRemove}
            onReorder={onReorder}
            onSkip={onSkip}
            headerAction={onDock && (
              <button type="button" onClick={onDock} title={t('queue.popInHint')} className={windowButtonClass}>
                <PopInIcon size={13} />
                {t('queue.popIn')}
              </button>
            )}
          />
        </div>
        {similarSongs?.length > 0 && (
          <div className="min-w-0 md:col-start-2">
            <SimilarSongs songs={similarSongs} onAdd={s => onAdd?.(s, 'queue-similar')} />
          </div>
        )}
      </main>
    </div>
  );
};

export default QueueWindow;
