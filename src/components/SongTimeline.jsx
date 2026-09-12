import React, { useMemo, useRef } from 'react';
import { useLiveFrame } from '../logic/liveStore';
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

const Cursor = ({ store, total }) => {
  const { tickData } = useLiveFrame(store);
  const sec = frameSeconds(tickData);
  const pct = total > 0 ? Math.max(0, Math.min(100, (sec / total) * 100)) : 0;
  return (
    <>
      <div className="absolute inset-y-0 left-0 rounded-l bg-gradient-to-r from-neon-cyan/50 to-white/40" style={{ width: `${pct}%` }} />
      <div className="absolute top-1/2 w-3.5 h-3.5 -mt-[7px] -ml-[7px] rounded-full bg-white shadow-[0_0_10px_rgba(0,229,255,0.9),0_0_20px_rgba(180,74,255,0.6)]" style={{ left: `${pct}%` }} />
      <span className="absolute right-0 -top-4 text-[10px] font-mono tabular-nums text-gray-300">
        {formatTime(sec)} / {formatTime(total)}
      </span>
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
