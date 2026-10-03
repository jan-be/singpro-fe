import React, { useRef, useSyncExternalStore } from 'react';
import Lyrics from './Lyrics';
import MusicBars from './MusicBars';

/**
 * Components wired to the live store so the party page itself does not
 * re-render at display rate. See liveStore.js.
 *
 * Lyrics re-render when a line or the sung syllable changes, a few times a
 * second; the sweep through the syllable follows the store inside Lyrics.
 * MusicBars subscribes to the store on its own and paints a canvas, so it is
 * not re-rendered here.
 */

const P1 = f => f.tickData;
const P2 = f => f.p2TickData;

// The empty line before the first one is a new [] every frame
const sameLine = (a, b) => a === b || (!!a && !!b && !a.length && !b.length);
// What Lyrics draws, but for the sweep: the lines, which syllable is sung
const sameText = (a, b) => sameLine(a.currentLine, b.currentLine) && sameLine(a.nextLine, b.nextLine)
  && a.lyricRef?.syllableIndex === b.lyricRef?.syllableIndex && a.lyricRef?.isSilent === b.lyricRef?.isSilent;
const sameLines = (a, b) => sameText(a.tickData, b.tickData)
  && (a.p2TickData && b.p2TickData ? sameText(a.p2TickData, b.p2TickData) : a.p2TickData === b.p2TickData);

/** The store's frame, but a new one only when a lyric line or syllable changes. */
const useLiveLines = (store) => {
  const shownRef = useRef(null);
  const get = () => {
    const frame = store.getFrame();
    if (!shownRef.current || !sameLines(shownRef.current, frame)) shownRef.current = frame;
    return shownRef.current;
  };
  return useSyncExternalStore(store.subscribe, get, get);
};

export const LiveLyrics = ({ store, label, compact }) => {
  const { tickData } = useLiveLines(store);
  return <Lyrics tickData={tickData} store={store} pick={P1} label={label} compact={compact} />;
};

/**
 * The lyrics band at the bottom of the stage: the singer's current + next
 * line, or — while a second singer has a line — both singers' current lines
 * stacked and labelled, without the next-line preview so the band stays low.
 */
export const LiveStageLyrics = ({ store, p1Label, p2Label }) => {
  const { tickData, p2TickData } = useLiveLines(store);
  if (!p2TickData?.currentLine) return <Lyrics tickData={tickData} store={store} pick={P1} />;
  return (
    <>
      <Lyrics tickData={tickData} store={store} pick={P1} label={p1Label} compact />
      <Lyrics tickData={p2TickData} store={store} pick={P2} label={p2Label} compact />
    </>
  );
};

export const LiveMusicBars = ({ store, isHost, playerColors, playerParts, scores, gapDragEnabled, setGap, onClick }) => (
  <MusicBars
    store={store}
    isHost={isHost}
    playerColors={playerColors}
    playerParts={playerParts}
    scores={scores}
    gapDragEnabled={gapDragEnabled}
    setGap={setGap}
    onClick={onClick}
  />
);
