import React from 'react';
import Lyrics from './Lyrics';
import MusicBars from './MusicBars';
import { useLiveFrame } from '../logic/liveStore';

/**
 * Components wired to the live store so the party page itself does not
 * re-render at display rate. See liveStore.js.
 *
 * Lyrics re-render per frame (a handful of spans). MusicBars subscribes to
 * the store on its own and paints a canvas, so it is not re-rendered here.
 */

export const LiveLyrics = ({ store, label, compact }) => {
  const { tickData } = useLiveFrame(store);
  return <Lyrics tickData={tickData} label={label} compact={compact} />;
};

/**
 * The lyrics band at the bottom of the stage: the singer's current + next
 * line, or — while a second singer has a line — both singers' current lines
 * stacked and labelled, without the next-line preview so the band stays low.
 */
export const LiveStageLyrics = ({ store, p1Label, p2Label }) => {
  const { tickData, p2TickData } = useLiveFrame(store);
  if (!p2TickData?.currentLine) return <Lyrics tickData={tickData} />;
  return (
    <>
      <Lyrics tickData={tickData} label={p1Label} compact />
      <Lyrics tickData={p2TickData} label={p2Label} compact />
    </>
  );
};

export const LiveMusicBars = ({ store, isHost, playerColors, scores, gapDragEnabled, setGap, onClick }) => (
  <MusicBars
    store={store}
    isHost={isHost}
    playerColors={playerColors}
    scores={scores}
    gapDragEnabled={gapDragEnabled}
    setGap={setGap}
    onClick={onClick}
  />
);
