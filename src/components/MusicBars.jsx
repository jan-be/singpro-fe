import React, { useMemo, useRef, useState, useEffect } from "react";
import { getRandInt } from "../logic/RandomUtility";
import useMeasure from "react-use-measure";

// Fixed vertical range in semitones. Every line uses the same span so that
// being off by N semitones always looks the same visually, regardless of how
// narrow/wide the expected notes in the current line are.
const VISIBLE_SEMITONES = 24;
const SVG_HEIGHT = 200;
const NOTE_HEIGHT = SVG_HEIGHT / VISIBLE_SEMITONES; // px per semitone

// Feedback thresholds (consecutive hit ticks on the correct note)
const GREAT_THRESHOLD = 8;
const AWESOME_THRESHOLD = 16;

const MusicBars = props => {
  const [ref, bounds] = useMeasure();
  let width = bounds.width ?? 600;

  let tickData = props.tickData;
  let hitNotesByPlayer = props.hitNotesByPlayer;

  // Sparkle state — accumulates sparkles over time, auto-cleans
  const [sparkles, setSparkles] = useState([]);
  const sparkleIdRef = useRef(0);
  const lastSparkleTickRef = useRef(-1);

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
  const tickWidth = width / lineLengthInTicks;

  // Determine which expected syllable each note belongs to, and if it's special
  const expectedNotes = tickData.currentLine.filter(el => !el.isBreak);

  // Check if current cursor position is on a special note
  const cursorTick = Math.floor(tickData.tickFloat);
  const currentRef = tickData.lyricData?.lyricRefs?.[cursorTick];
  const currentSyllable = currentRef && !currentRef.isSilent
    ? tickData.lyricData?.lyricLines?.[currentRef.lineIndex]?.[currentRef.syllableIndex]
    : null;
  const isOnSpecialNote = currentSyllable?.isSpecial ?? false;

  // --- Build continuous line segments per player ---
  const playerSegments = {};
  const playerFeedback = {}; // { username: { text, x, y } }

  for (const [username, hitNotes] of Object.entries(hitNotesByPlayer)) {
    const filteredTicks = hitNotes.ticks
      .filter(e => e.tick >= lineStartTick && e.tick <= lastLineTick && e.note !== 0);

    if (filteredTicks.length === 0) continue;

    const segments = [];
    let currentSegment = null;

    for (const { tick, note } of filteredTicks) {
      const clampedY = Math.max(0, Math.min(SVG_HEIGHT - NOTE_HEIGHT, toneToY(note) - NOTE_HEIGHT / 2)) + NOTE_HEIGHT / 2;

      // Check if this note is a hit (within ±1 semitone of expected)
      const ref = tickData.lyricData?.lyricRefs?.[tick];
      const syllable = ref && !ref.isSilent
        ? tickData.lyricData?.lyricLines?.[ref.lineIndex]?.[ref.syllableIndex]
        : null;
      const expectedTone = syllable?.tone;
      const isHit = expectedTone !== undefined && Math.abs(note - expectedTone) <= 1;
      const isSpecial = syllable?.isSpecial ?? false;

      if (currentSegment &&
          Math.abs(note - currentSegment.note) <= 1 &&
          tick - currentSegment.endTick <= 2) {
        // Continue segment
        currentSegment.endTick = tick;
        currentSegment.points.push({ x: tickToX(tick), y: clampedY });
        if (isHit) currentSegment.hitCount++;
        currentSegment.isSpecial = currentSegment.isSpecial || isSpecial;
      } else {
        // Start new segment
        if (currentSegment) segments.push(currentSegment);
        currentSegment = {
          note,
          startTick: tick,
          endTick: tick,
          points: [{ x: tickToX(tick), y: clampedY }],
          username,
          hitCount: isHit ? 1 : 0,
          isSpecial,
        };
      }
    }
    if (currentSegment) segments.push(currentSegment);

    playerSegments[username] = segments;

    // Find the latest active segment for feedback text
    const activeSegment = segments.find(s => s.endTick >= cursorTick - 2 && s.startTick <= cursorTick);
    if (activeSegment && activeSegment.hitCount >= GREAT_THRESHOLD) {
      const text = activeSegment.hitCount >= AWESOME_THRESHOLD ? "AWESOME!" : "GREAT!";
      const lastPt = activeSegment.points[activeSegment.points.length - 1];
      playerFeedback[username] = { text, x: lastPt.x, y: lastPt.y - 20 };
    }
  }

  return (
    <div className="max-w-3xl mx-auto relative">
      <svg width="100%" viewBox={`0 0 ${width} ${SVG_HEIGHT}`} ref={ref}>
        <defs>
          {/* Glow filter for special notes */}
          <filter id="specialGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feFlood floodColor="#FFD700" floodOpacity="0.6" result="color" />
            <feComposite in="color" in2="blur" operator="in" result="glow" />
            <feMerge>
              <feMergeNode in="glow" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          {/* Glow filter for hit segments */}
          <filter id="lineGlow" x="-20%" y="-50%" width="140%" height="200%">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Semitone grid lines for visual reference */}
        {Array.from({ length: VISIBLE_SEMITONES + 1 }, (_, i) => {
          const tone = lowerBound + i;
          const y = toneToY(tone);
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
        {expectedNotes.map((el, i) => {
          const lineIdx = i + 1; // offset by 1 because first element is a break
          const isCurrent = tickData.lyricRef.syllableIndex === lineIdx && !tickData.lyricRef.isSilent;

          return (
            <g key={`note-${i}`}>
              {/* Special note golden outline */}
              {el.isSpecial && (
                <rect
                  x={tickToX(el.start) - 1}
                  y={toneToY(el.tone) - NOTE_HEIGHT / 2 - 1}
                  width={(el.length / lineLengthInTicks) * width + 2}
                  height={NOTE_HEIGHT + 2}
                  fill="none"
                  stroke="#FFD700"
                  strokeWidth="1.5"
                  rx={NOTE_HEIGHT / 2 + 1}
                  ry={NOTE_HEIGHT / 2 + 1}
                  filter="url(#specialGlow)"
                  opacity={isCurrent ? 1 : 0.5}
                />
              )}
              <rect
                x={tickToX(el.start)}
                y={toneToY(el.tone) - NOTE_HEIGHT / 2}
                width={(el.length / lineLengthInTicks) * width}
                height={NOTE_HEIGHT}
                fill={el.isSpecial
                  ? (isCurrent ? "#FFD700" : "#b8860b")
                  : (isCurrent ? "#39ff14" : "#b44aff")
                }
                stroke={el.isSpecial ? "rgba(255,215,0,0.4)" : "rgba(255,255,255,0.3)"}
                rx={NOTE_HEIGHT / 2}
                ry={NOTE_HEIGHT / 2}
              />
              {/* Star icon for special notes */}
              {el.isSpecial && (
                <text
                  x={tickToX(el.start) + (el.length / lineLengthInTicks) * width / 2}
                  y={toneToY(el.tone) + 1}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize="6"
                  fill="rgba(255,255,255,0.7)"
                >
                  ★
                </text>
              )}
            </g>
          );
        })}

        {/* Playback cursor */}
        <rect
          x={shareOfTimeForLine * width}
          y={0}
          width={3}
          height={SVG_HEIGHT}
          fill={isOnSpecialNote ? "rgba(255,215,0,0.8)" : "rgba(255,255,255,0.6)"}
        />
        {/* Cursor glow on special notes */}
        {isOnSpecialNote && (
          <rect
            x={shareOfTimeForLine * width - 4}
            y={0}
            width={11}
            height={SVG_HEIGHT}
            fill="rgba(255,215,0,0.15)"
            rx={5}
          />
        )}

        {/* Player hit-note continuous lines */}
        {Object.entries(playerSegments).map(([username, segments]) => {
          const hue = getRandInt(0, 360, username);
          const color = `hsl(${hue}, 100%, 55%)`;
          const glowColor = `hsl(${hue}, 100%, 70%)`;

          return segments.map((seg, si) => {
            if (seg.points.length < 2) {
              // Single point — draw a small circle
              const pt = seg.points[0];
              return (
                <circle
                  key={`${username}-seg-${si}`}
                  cx={pt.x + tickWidth / 2}
                  cy={pt.y}
                  r={NOTE_HEIGHT * 0.4}
                  fill={seg.isSpecial ? "#FFD700" : color}
                  filter="url(#lineGlow)"
                />
              );
            }

            // Build a smooth path through the points
            const pathParts = [];
            for (let pi = 0; pi < seg.points.length; pi++) {
              const pt = seg.points[pi];
              const x = pt.x + tickWidth / 2;
              if (pi === 0) {
                pathParts.push(`M ${x} ${pt.y}`);
              } else {
                const prev = seg.points[pi - 1];
                const prevX = prev.x + tickWidth / 2;
                const cpX = (prevX + x) / 2;
                pathParts.push(`C ${cpX} ${prev.y}, ${cpX} ${pt.y}, ${x} ${pt.y}`);
              }
            }
            const pathD = pathParts.join(" ");

            return (
              <g key={`${username}-seg-${si}`}>
                {/* Glow layer */}
                <path
                  d={pathD}
                  fill="none"
                  stroke={seg.isSpecial ? "rgba(255,215,0,0.4)" : `hsl(${hue}, 100%, 50%, 0.3)`}
                  strokeWidth={NOTE_HEIGHT * 1.2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {/* Main line */}
                <path
                  d={pathD}
                  fill="none"
                  stroke={seg.isSpecial ? "#FFD700" : color}
                  strokeWidth={NOTE_HEIGHT * 0.6}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  filter="url(#lineGlow)"
                />
                {/* Bright core */}
                <path
                  d={pathD}
                  fill="none"
                  stroke={seg.isSpecial ? "#FFFACD" : glowColor}
                  strokeWidth={NOTE_HEIGHT * 0.2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </g>
            );
          });
        })}

        {/* Sparkle particles near cursor when hitting special notes */}
        <SparkleParticles
          active={isOnSpecialNote && Object.keys(hitNotesByPlayer).length > 0}
          cx={shareOfTimeForLine * width}
          cy={currentSyllable ? toneToY(currentSyllable.tone) : SVG_HEIGHT / 2}
          svgHeight={SVG_HEIGHT}
        />

        {/* Feedback text ("GREAT!", "AWESOME!") */}
        {Object.entries(playerFeedback).map(([username, fb]) => {
          const hue = getRandInt(0, 360, username);
          const isAwesome = fb.text === "AWESOME!";
          return (
            <g key={`fb-${username}`}>
              <text
                x={fb.x}
                y={fb.y}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={isAwesome ? "16" : "13"}
                fontWeight="bold"
                fill={isAwesome ? "#FFD700" : `hsl(${hue}, 100%, 80%)`}
                stroke={isAwesome ? "rgba(255,215,0,0.3)" : "none"}
                strokeWidth="3"
                paintOrder="stroke"
                className={isAwesome ? "animate-pulse" : ""}
              >
                {fb.text}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
};

/**
 * Sparkle particles — animated SVG circles that spawn near a point
 * and float outward with randomized trajectories.
 */
const SparkleParticles = ({ active, cx, cy, svgHeight }) => {
  const [particles, setParticles] = useState([]);
  const idRef = useRef(0);
  const lastSpawnRef = useRef(0);

  useEffect(() => {
    if (!active) return;

    let rafId;
    const animate = () => {
      const now = performance.now();

      // Spawn new particles every ~80ms
      if (now - lastSpawnRef.current > 80) {
        lastSpawnRef.current = now;
        const count = 1 + Math.floor(Math.random() * 2);
        const newParticles = [];
        for (let i = 0; i < count; i++) {
          newParticles.push({
            id: idRef.current++,
            x: cx + (Math.random() - 0.5) * 30,
            y: cy + (Math.random() - 0.5) * 20,
            vx: (Math.random() - 0.5) * 1.5,
            vy: -(0.3 + Math.random() * 1.2),
            size: 1 + Math.random() * 2.5,
            life: 1,
            decay: 0.015 + Math.random() * 0.02,
            hue: 40 + Math.random() * 30, // gold range
          });
        }
        setParticles(prev => [...prev.filter(p => p.life > 0), ...newParticles]);
      }

      // Update existing particles
      setParticles(prev => prev
        .map(p => ({
          ...p,
          x: p.x + p.vx,
          y: p.y + p.vy,
          life: p.life - p.decay,
        }))
        .filter(p => p.life > 0)
      );

      rafId = requestAnimationFrame(animate);
    };
    rafId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafId);
  }, [active, cx, cy]);

  // Clean up particles when deactivated
  useEffect(() => {
    if (!active && particles.length > 0) {
      const timeout = setTimeout(() => setParticles([]), 1000);
      return () => clearTimeout(timeout);
    }
  }, [active]);

  return (
    <>
      {particles.map(p => (
        <circle
          key={p.id}
          cx={p.x}
          cy={p.y}
          r={p.size * p.life}
          fill={`hsla(${p.hue}, 100%, 75%, ${p.life * 0.8})`}
        />
      ))}
    </>
  );
};

export default MusicBars;
