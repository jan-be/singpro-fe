import React, { useLayoutEffect, useMemo, useRef } from 'react';
import { frameSeconds, formatTime } from '../logic/songRegions';

/**
 * Our own progress bar for the song (YouTube's is covered). The stretches
 * where somebody sings are marked — purple for the first singer, orange for
 * the second — and the host can click or drag to seek.
 *
 * The regions are static per song, so they are a memoised layer; only the
 * cursor and the time label follow the live store frame by frame.
 */
const P1 = '#b44aff';
const P2 = '#ff8c42';

const Regions = React.memo(({ regions, total }) => (
  <>
    {regions.map((r, i) => (
      <div
        key={i}
        className="absolute h-full rounded-sm"
        style={{
          left: `${(r.start / total) * 100}%`,
          width: `${Math.max(0.3, ((r.end - r.start) / total) * 100)}%`,
          background: r.player === 2 ? P2 : P1,
          opacity: 0.75,
          top: r.player === 2 ? '50%' : 0,
          height: regions.some(x => x.player === 2) ? '50%' : '100%',
        }}
      />
    ))}
  </>
));

// The thumb (w-3.5, centred by -ml-[7px]), in CSS px
const THUMB_WIDTH = 14;
const THUMB_MARGIN = -7;

// Layout works in 1/64 px. A percentage length resolves through 32-bit floats
// and is truncated to that grid; a box is painted at whole pixels, rounded.
const f32 = Math.fround;
const grid = (x) => Math.round(x * 64) / 64;
const lengthOf = (px) => Math.trunc(f32(px) * 64) / 64;
const percentOf = (base, pct) => Math.trunc(f32(f32(f32(f32(base) * f32(pct)) / 100) * 64)) / 64;
const pixelOf = (x) => Math.floor(x + 0.5);

/**
 * The pixels the cursor's painted edges land on at `pct` — the fill's right
 * end and the thumb's two sides — as a key: while it stays the same, writing
 * the new `pct` would repaint the same picture. Counted in device pixels
 * (Chrome on a phone lays out in those) and in CSS pixels (where the scale is
 * applied after layout, as in device emulation), so it holds either way.
 */
const cursorPixels = (geo, pct) => {
  let key = '';
  for (const scale of [geo.dpr, 1]) {
    const end = grid(geo.left * scale) + percentOf(grid(geo.width * scale), pct);
    const thumb = end + lengthOf(THUMB_MARGIN * scale);
    key += `${pixelOf(end)} ${pixelOf(thumb)} ${pixelOf(thumb + lengthOf(THUMB_WIDTH * scale))} `;
  }
  return key;
};

/**
 * The cursor and the time label follow the store without React: the store
 * changes every frame, but at a song's length the cursor moves only a few
 * device pixels a second. So the width / left are written when a painted edge
 * reaches another pixel (and the label when its text changes); every frame
 * between used to re-lay out and repaint the bar for the same picture.
 */
const Cursor = ({ store, total }) => {
  const fillRef = useRef(null);
  const thumbRef = useRef(null);
  const timeRef = useRef(null);

  useLayoutEffect(() => {
    const fill = fillRef.current, thumb = thumbRef.current;
    const bar = fill.parentElement;
    // The label as the three text nodes it always was ("1:05", " / ", "3:20"),
    // which the browser places a hair differently from one joined string
    const time = timeRef.current;
    while (time.firstChild) time.removeChild(time.firstChild);
    const secText = document.createTextNode('');
    for (const node of [secText, document.createTextNode(' / '), document.createTextNode(formatTime(total))]) time.appendChild(node);
    let geo = null; // where the bar is, measured after layout changes
    let shownPixels = null;

    const update = () => {
      const sec = frameSeconds(store.getFrame().tickData);
      const pct = total > 0 ? Math.max(0, Math.min(100, (sec / total) * 100)) : 0;
      const pixels = geo ? cursorPixels(geo, pct) : null;
      if (pixels === null || pixels !== shownPixels) {
        fill.style.width = `${pct}%`;
        thumb.style.left = `${pct}%`;
      }
      shownPixels = pixels;
      const text = formatTime(sec);
      if (text !== secText.data) secText.data = text;
    };
    // Read in a ResizeObserver callback or a resize event, where layout is
    // done anyway, never from the per-frame update (a forced layout).
    const measure = () => {
      const r = bar.getBoundingClientRect();
      geo = { left: r.left, width: r.width, dpr: window.devicePixelRatio || 1 };
      shownPixels = null;
      update();
    };

    update();
    const unsubscribe = store.subscribe(update);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(bar);
    window.addEventListener('resize', measure);
    return () => {
      unsubscribe();
      ro?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [store, total]);

  return (
    <>
      <div ref={fillRef} className="absolute inset-y-0 left-0 rounded-l bg-gradient-to-r from-neon-cyan/50 to-white/40" />
      <div ref={thumbRef} className="absolute top-1/2 w-3.5 h-3.5 -mt-[7px] -ml-[7px] rounded-full bg-white shadow-[0_1px_4px_rgba(0,0,0,0.5)]" />
      <span ref={timeRef} className="absolute right-0 -top-4 text-[10px] font-mono tabular-nums text-white/70" />
    </>
  );
};

const SongTimeline = ({ store, regions, duration, onSeek, label }) => {
  const total = useMemo(() => (duration > 0 ? duration : (regions.length ? regions[regions.length - 1].end + 5 : 0)), [duration, regions]);
  const barRef = useRef(null);
  const dragging = useRef(false);

  const fractionAt = (e) => {
    const rect = barRef.current.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  };
  const seekTo = (e) => { if (onSeek && total > 0) onSeek(fractionAt(e) * total); };

  return (
    <div
      ref={barRef}
      role={onSeek ? 'slider' : 'progressbar'}
      aria-label={label}
      className={`relative h-2.5 mx-3 mb-2 mt-5 rounded bg-white/15 ${onSeek ? 'cursor-pointer' : ''}`}
      onPointerDown={onSeek ? (e) => { dragging.current = true; e.currentTarget.setPointerCapture(e.pointerId); seekTo(e); } : undefined}
      onPointerMove={onSeek ? (e) => { if (dragging.current) seekTo(e); } : undefined}
      onPointerUp={onSeek ? (e) => { dragging.current = false; e.currentTarget.releasePointerCapture(e.pointerId); } : undefined}
      onPointerCancel={onSeek ? () => { dragging.current = false; } : undefined}
    >
      {total > 0 && <Regions regions={regions} total={total} />}
      {total > 0 && <Cursor store={store} total={total} />}
    </div>
  );
};

export default SongTimeline;
