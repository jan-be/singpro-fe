import React, { useLayoutEffect, useRef } from "react";

import css from './Lyrics.module.css';

const CYAN = '#00e5ff';
const GRAY = '#e0e0e0';

// "~" marks a held note, the previous syllable sung on (about 6 % of USDB
// syllables): the note stays on the highway, the text shows the word once
const shown = (syllable) => syllable.replace(/~/g, '');

/** The sung syllable's colour at this frame: cyan as far as it has been sung, then gray. */
const sweepAt = (tickData, el) => {
  const progress = Math.max(0, Math.min(1,
    (tickData.tickFloat - el.start) / Math.max(1, el.length)
  ));
  const pct = (progress * 100).toFixed(1);
  return `linear-gradient(90deg, ${CYAN} ${pct}%, ${GRAY} ${pct}%)`;
};

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
 */
const Lyrics = ({ tickData, store, pick, label, compact }) => {
  const line = tickData.currentLine;
  const lyricRef = tickData.lyricRef;
  const lineText = line ? line.map(el => (el.isBreak ? '' : shown(el.syllable))).join('') : '';
  const sungIndex = line && lyricRef && !lyricRef.isSilent ? lyricRef.syllableIndex : -1;
  const sung = sungIndex >= 0 ? line[sungIndex] : null;
  const sweepRef = useRef(null);

  useLayoutEffect(() => {
    const span = sweepRef.current;
    if (!span || !sung) return undefined;
    let shownSweep = null;
    const update = () => {
      const td = pick(store.getFrame());
      // Another line or syllable: the line re-renders this frame and runs this anew
      if (!td || td.currentLine !== line || td.lyricRef?.syllableIndex !== sungIndex || td.lyricRef.isSilent) return;
      const sweep = sweepAt(td, sung);
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
        <div className={css.glow} aria-hidden="true">{lineText}&nbsp;</div>
        <div className={css.line}>
          {line && line.map((el, i) => {
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
        <div className={css.lyrics2}>
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
