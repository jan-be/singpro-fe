import React from "react";
import { getRandInt } from "../logic/RandomUtility";
import useMeasure from "react-use-measure";

// Fixed vertical range in semitones. Every line uses the same span so that
// being off by N semitones always looks the same visually, regardless of how
// narrow/wide the expected notes in the current line are.
const VISIBLE_SEMITONES = 24;
const SVG_HEIGHT = 200;
const NOTE_HEIGHT = SVG_HEIGHT / VISIBLE_SEMITONES; // px per semitone

const MusicBars = props => {
  const [ref, bounds] = useMeasure();
  let width = bounds.width ?? 600;

  let tickData = props.tickData;
  let hitNotesByPlayer = props.hitNotesByPlayer;

  if (!tickData.currentLine || !tickData.currentLine[1]) {
    return null;
  }

  // --- Vertical range: fixed span, centered on the line's midpoint ---
  const tones = tickData.currentLine.filter(e => !e.isBreak).map(e => e.tone);
  const minTone = Math.min(...tones);
  const maxTone = Math.max(...tones);
  const midTone = (minTone + maxTone) / 2;
  const lowerBound = midTone - VISIBLE_SEMITONES / 2;
  const upperBound = midTone + VISIBLE_SEMITONES / 2;

  // Map a tone value to SVG y coordinate (higher tones → lower y / higher on screen)
  const toneToY = tone =>
    SVG_HEIGHT - ((tone - lowerBound) / (upperBound - lowerBound)) * SVG_HEIGHT;

  // --- Horizontal range ---
  let lineStartTick = tickData.currentLine[1].start;
  let lastEl = tickData.currentLine[tickData.currentLine.length - 1];
  let lastLineTick = lastEl.start + lastEl.length;
  let lineLengthInTicks = lastLineTick - lineStartTick;
  let shareOfTimeForLine = (tickData.tickFloat - lineStartTick) / lineLengthInTicks;

  // Map a tick to SVG x coordinate
  const tickToX = tick => ((tick - lineStartTick) / lineLengthInTicks) * width;

  return (
    <div className="max-w-3xl mx-auto">
      <svg width="100%" viewBox={`0 0 ${width} ${SVG_HEIGHT}`} ref={ref}>

        {/* Semitone grid lines for visual reference */}
        {Array.from({ length: VISIBLE_SEMITONES + 1 }, (_, i) => {
          const tone = lowerBound + i;
          const y = toneToY(tone);
          // Brighter line every octave (C notes), subtle for others
          const isOctave = Math.round(tone) % 12 === 0;
          return (
            <line
              key={`grid-${i}`}
              x1={0} x2={width}
              y1={y} y2={y}
              stroke={isOctave ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.04)"}
              strokeWidth={isOctave ? 1 : 0.5}
            />
          );
        })}

        {/* Expected note bars */}
        {tickData.currentLine.filter(el => !el.isBreak).map((el, i) => {
          let isCurrent = tickData.lyricRef.syllableIndex === i + 1 && !tickData.lyricRef.isSilent;

          return (
            <rect
              key={`note-${i}`}
              x={tickToX(el.start)}
              y={toneToY(el.tone) - NOTE_HEIGHT / 2}
              width={(el.length / lineLengthInTicks) * width}
              height={NOTE_HEIGHT}
              fill={isCurrent ? "#39ff14" : "#b44aff"}
              stroke="rgba(255,255,255,0.3)"
              rx={NOTE_HEIGHT / 2}
              ry={NOTE_HEIGHT / 2}
            />
          );
        })}

        {/* Playback cursor */}
        <rect
          x={shareOfTimeForLine * width}
          y={0}
          width={3}
          height={SVG_HEIGHT}
          fill="rgba(255,255,255,0.6)"
        />

        {/* Player hit-note dots */}
        {Object.entries(hitNotesByPlayer)
          .map(([username, hitNotes]) => hitNotes.ticks
            .filter(e => e.tick >= lineStartTick && e.tick <= lastLineTick)
            .map(({ tick, note }) => {
              if (note === 0) return null;

              let randInt = getRandInt(0, 360, username);

              // Clamp to visible range so off-screen notes still show at edges
              const clampedY = Math.max(0, Math.min(SVG_HEIGHT - NOTE_HEIGHT, toneToY(note) - NOTE_HEIGHT / 2));

              return (
                <rect
                  key={`${username}-${tick}`}
                  fill={`hsl(${randInt}, 100%, 50%)`}
                  x={tickToX(tick)}
                  y={clampedY}
                  width={NOTE_HEIGHT}
                  height={NOTE_HEIGHT}
                  rx={NOTE_HEIGHT / 2}
                  ry={NOTE_HEIGHT / 2}
                />
              );
            }))}
      </svg>
    </div>
  );
};

export default MusicBars;
