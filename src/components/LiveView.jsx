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

export const LiveLyrics = ({ store }) => {
  const { tickData } = useLiveFrame(store);
  return <Lyrics tickData={tickData} />;
};

/** Second singer's line in duet mode; renders nothing while P2 has no line. */
export const LiveP2Lyrics = ({ store, label }) => {
  const { p2TickData } = useLiveFrame(store);
  if (!p2TickData?.currentLine) return null;
  return <Lyrics tickData={p2TickData} label={label} />;
};

export const LiveMusicBars = ({ store, isHost, playerColors, gapDragEnabled, setGap }) => (
  <MusicBars
    store={store}
    isHost={isHost}
    playerColors={playerColors}
    gapDragEnabled={gapDragEnabled}
    setGap={setGap}
  />
);
