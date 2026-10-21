import React, { useLayoutEffect, useRef } from "react";

import css from './Lyrics.module.css';
import type { LiveFrame, LiveStore } from '../logic/liveStore';
import type { LyricElement, TickData } from '../logic/LyricsParser';

const CYAN = '#00e5ff';
const GRAY = '#e0e0e0';

// "~" marks a held note, the previous syllable sung on (about 6 % of USDB
// syllables): the note stays on the highway, the text shows the word once
const shown = (syllable: string) => syllable.replace(/~/g, '');

// Hebrew, Arabic (Persian, Urdu) and Syriac letters: a syllable in them is read, and swept, from right to left
const RTL = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;

/** The sung syllable's colour at this frame: cyan as far as it has been sung (from its first letter), then gray. */
const sweepAt = (tickFloat: TickData['tickFloat'], el: LyricElement) => {
  const progress = Math.max(0, Math.min(1,
    (tickFloat - el.start) / Math.max(1, el.length)
  ));
  const pct = (progress * 100).toFixed(1);
  return `linear-gradient(${RTL.test(el.syllable) ? 270 : 90}deg, ${CYAN} ${pct}%, ${GRAY} ${pct}%)`;
};

export interface LyricsProps {
  /** this track's tick data, new only when the line or the sung syllable changes */
  tickData: Partial<TickData>;
  store: LiveStore;
  /** this track's tick data in a frame of the store */
  pick: (frame: LiveFrame) => Partial<TickData> | null;
  label?: React.ReactNode;
  compact?: boolean;
}

/**
 * Current + next lyric line. The glow is a static, invisible copy of the line
 * underneath with a text-shadow: it repaints only when the line changes, while
 * the per-frame update touches plain, unfiltered text.
 *
 * `tickData` only has to be new when the line or the sung syllable changes
 * (see LiveView). The sweep through the sung syllable moves every frame, so
 * it follows the live store (`pick(frame)` is this track's tick data) and
 * sets the gradient on that one span, without re-rendering the line. Inline,
 * as before: the browser restyles a changed inline background on a fast path
 * (a custom property for it made the style recalc dearer in the benchmark).
 *
 * `compact`: current line only, tighter — for stacked duet lines.
 * Each line takes its direction from its first letter (dir="auto"): an Arabic
 * or Hebrew line reads from the right, with its punctuation where it belongs.
 */
const Lyrics = ({ tickData, store, pick, label, compact }: LyricsProps) => {
  const line = tickData.currentLine;
  const lyricRef = tickData.lyricRef;
  const lineText = line ? line.map(el => (el.isBreak ? '' : shown(el.syllable))).join('') : '';
  const sungIndex = line && lyricRef && !lyricRef.isSilent ? lyricRef.syllableIndex : -1;
  const sung = line && sungIndex >= 0 ? line[sungIndex] : null;
  const sweepRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const span = sweepRef.current;
    if (!span || !sung) return undefined;
    let shownSweep: string | null = null;
    const update = () => {
      const td = pick(store.getFrame());
      // Another line or syllable: the line re-renders this frame and runs this anew
      // (the line shown: a whole frame, with its tick, not the {} before the first)
      if (!td || td.currentLine !== line || td.lyricRef?.syllableIndex !== sungIndex || td.lyricRef.isSilent || td.tickFloat === undefined) return;
      const sweep = sweepAt(td.tickFloat, sung);
      if (sweep !== shownSweep) { span.style.backgroundImage = sweep; shownSweep = sweep; }
    };
    update();
    const unsubscribe = store.subscribe(update);
    return () => {
      unsubscribe();
      span.style.backgroundImage = ''; // React keeps the span for the next syllable's class
    };
  }, [store, pick, line, sungIndex, sung]);

  return (
    <div className={compact ? `${css.lyrics} ${css.compact}` : css.lyrics}>
      {label && <div className={css.trackLabel}>{label}</div>}
      <div className={css.lyrics1}>
        <div className={css.glow} dir="auto" aria-hidden="true">{lineText}&nbsp;</div>
        <div className={css.line} dir="auto">
          {/* (a line has its place: getTickData's line is [] without one) */}
          {line && lyricRef && line.map((el, i) => {
            if (el.isBreak) return null;
            if (i === sungIndex) {
              return <span key={i} ref={sweepRef} className={css.sweepText}>{shown(el.syllable)}</span>;
            }
            return (
              <span key={i} className={i < lyricRef.syllableIndex ? css.pastText : css.futureText}>
                {shown(el.syllable)}
              </span>
            );
          })}
          &nbsp;
        </div>
      </div>
      {!compact && (
        <div className={css.lyrics2} dir="auto">
          {tickData.nextLine && tickData.nextLine.map((el, i) =>
            el.isBreak ? null : <span key={i}>{shown(el.syllable)}</span>)
          }
          &nbsp;
        </div>
      )}
    </div>
  );
};

export default Lyrics;
