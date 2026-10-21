import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Avatar from './Avatar';
import { playerHue, type PlayerColors } from '../logic/playerColor';
import { rankSingers } from '../logic/scoreStrip';
import type { AvatarPaths } from '../logic/avatar';
import type { LiveStore } from '../logic/liveStore';

export interface LiveScoreStripProps {
  store: LiveStore;
  /** the JSON scoreboard (React state): username -> { score } */
  scores: Record<string, { score: number }> | null | undefined;
  colors?: PlayerColors | null;
  avatars?: AvatarPaths | null;
  /** your name in the party */
  me: string;
  /** username -> the duet part they sing, 1 or 2 */
  parts?: Record<string, number> | null;
  duet?: boolean;
  max?: number;
}

/**
 * The scores, always in view above the highway: everyone who sang this song,
 * best first, with their picture (logic/scoreStrip.js decides who and in what
 * order). The tags on the highway follow the singing; this stays put.
 *
 * It renders again only when who is shown, or the order, changes. The numbers
 * move with every batch of notes, many times a second, so they are written
 * straight into their elements from the live store (liveStore.js), the way
 * the lyrics and the countdown avoid a React render per frame on weak hosts.
 */
const LiveScoreStrip = ({ store, scores, colors, avatars, me, parts, duet, max = 8 }: LiveScoreStripProps) => {
  const { t } = useTranslation();
  const scoresRef = useRef(scores);
  scoresRef.current = scores;
  const read = useCallback(
    () => rankSingers({ scores: scoresRef.current, live: store.scores, lanes: store.lanes, standing: store.standing, me, max }),
    [store, me, max],
  );
  const [view, setView] = useState(read);
  const keyRef = useRef(view.key);
  const numbers = useRef(new Map<string, { el: HTMLSpanElement; score: number }>()); // username -> { el, score } of the number on screen

  useEffect(() => {
    const update = () => {
      const next = read();
      if (next.key !== keyRef.current) {
        keyRef.current = next.key;
        setView(next);
        return;
      }
      for (const r of next.rows) {
        const n = numbers.current.get(r.username);
        if (n && n.score !== r.score) {
          n.score = r.score;
          n.el.textContent = r.score.toLocaleString();
        }
      }
    };
    update(); // the board in React state changed, or a new store
    return store.subscribe(update);
  }, [store, read, scores]);

  if (view.rows.length === 0) return null;
  const chip = 'flex items-center gap-1.5 h-7 pl-0.5 pr-2.5 rounded-full flex-shrink-0 bg-[rgba(10,10,26,0.75)] ring-1 ring-inset';
  return (
    <div className="relative z-10 flex justify-center pb-1.5 min-w-0">
      <ol aria-label={t('party.scores')} className="flex gap-1.5 overflow-x-auto max-w-full [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {view.rows.map(r => {
          const hue = playerHue(colors, r.username);
          const isMe = r.username === me;
          return (
            <li key={r.username} className={`${chip} ${isMe ? 'ring-white/45' : 'ring-white/10'}`} style={{ color: `hsl(${hue}, 100%, 82%)` }}>
              <Avatar username={r.username} src={avatars?.[r.username] ?? null} hue={hue} size={24} className="text-[11px]" />
              <span className="text-xs font-medium text-white/90 truncate max-w-[7rem]">{r.username}</span>
              {duet && <span className="text-[10px] font-semibold text-white/60">P{parts?.[r.username] ?? 1}</span>}
              <span
                ref={el => { if (el) numbers.current.set(r.username, { el, score: r.score }); else numbers.current.delete(r.username); }}
                className="text-xs font-bold tabular-nums"
              >
                {r.score.toLocaleString()}
              </span>
            </li>
          );
        })}
        {view.mine && (
          // In a crowd: your own place among everyone, when the screen shows others
          <li className={`${chip} ring-white/45 text-white/85`}>
            <Avatar username={me} src={avatars?.[me] ?? null} hue={playerHue(colors, me)} size={24} className="text-[11px]" />
            <span className="text-xs font-medium tabular-nums">#{view.mine.rank} / {view.mine.total}</span>
            <span className="text-xs font-bold tabular-nums">{view.mine.score.toLocaleString()}</span>
          </li>
        )}
      </ol>
    </div>
  );
};

export default React.memo(LiveScoreStrip);
