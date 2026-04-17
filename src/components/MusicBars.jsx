import React, { useMemo, useRef, useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { getRandInt } from "../logic/RandomUtility";
import useMeasure from "react-use-measure";
import { apiUrl } from "../GlobalConsts";

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
  const { t } = useTranslation();
  const [ref, bounds] = useMeasure();
  let width = bounds.width ?? 600;

  let tickData = props.tickData;
  let hitNotesByPlayer = props.hitNotesByPlayer;
  const isHost = props.isHost;
  const gapData = props.gapData;  // { gap, defaultGap, setGap } — same shape as GapCorrector
  const songId = props.songId;

  // --- Gap drag state (host only) ---
  // Drag the cursor left/right to shift the gap. Past a threshold, snap to
  // prev/next lyric line ("iPhone page-snap"). Live-previews via gapData.setGap;
  // commits to server on pointerup via PATCH /songs/:id.
  const [dragState, setDragState] = useState(null); // { startX, startGap, lineDurationMs, rectWidth }


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

  // --- Horizontal range (with minimum duration to prevent short lines being too fast) ---
  let lineStartTick = tickData.currentLine[1].start;
  let lastEl = tickData.currentLine[tickData.currentLine.length - 1];
  let lastLineTick = lastEl.start + lastEl.length;
  let naturalLength = lastLineTick - lineStartTick;

  // Calculate a minimum tick length based on the song's line durations.
  // Use the median line length so short lines get padded to a reasonable speed.
  const lyricLines = tickData.lyricData?.lyricLines;
  let minTickLength = naturalLength; // fallback: no padding
  if (lyricLines && lyricLines.length > 2) {
    const lineLengths = lyricLines
      .filter(line => line.length > 1 && !line[1].isBreak)
      .map(line => {
        const last = line[line.length - 1];
        return (last.start + last.length) - line[1].start;
      })
      .sort((a, b) => a - b);
    if (lineLengths.length > 0) {
      const median = lineLengths[Math.floor(lineLengths.length / 2)];
      minTickLength = Math.round(median * 0.6);
    }
  }

  // If the line is shorter than the minimum, extend the visible range symmetrically
  if (naturalLength < minTickLength) {
    const pad = (minTickLength - naturalLength) / 2;
    lineStartTick -= pad;
    lastLineTick += pad;
  }

  let lineLengthInTicks = lastLineTick - lineStartTick;
  let shareOfTimeForLine = (tickData.tickFloat - lineStartTick) / lineLengthInTicks;

  // Cursor x position (float-based for smooth movement)
  const cursorX = shareOfTimeForLine * width;

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

  // First pass: collect all player notes per tick for overlap detection
  // Key: tick, Value: array of { username, note }
  const notesByTick = {};

  for (const [username, hitNotes] of Object.entries(hitNotesByPlayer)) {
    for (const { tick, note } of hitNotes.ticks) {
      if (tick < lineStartTick || tick > lastLineTick || note === 0) continue;
      if (!notesByTick[tick]) notesByTick[tick] = [];
      notesByTick[tick].push({ username, note });
    }
  }

  // For a given tick+note, figure out the vertical offset and overlap count
  // when multiple players are singing within ±1 semitone
  const getOverlapInfo = (tick, note, username) => {
    const atTick = notesByTick[tick];
    if (!atTick) return { offset: 0, count: 1 };
    const overlapping = atTick.filter(e => Math.abs(e.note - note) <= 1);
    if (overlapping.length <= 1) return { offset: 0, count: 1 };
    const myIdx = overlapping.findIndex(e => e.username === username);
    if (myIdx < 0) return { offset: 0, count: 1 };
    // Spread players symmetrically: -0.5, +0.5 for 2 players; -1, 0, +1 for 3, etc.
    const spread = NOTE_HEIGHT * 0.4;
    const center = (overlapping.length - 1) / 2;
    return { offset: (myIdx - center) * spread, count: overlapping.length };
  };

  for (const [username, hitNotes] of Object.entries(hitNotesByPlayer)) {
    const filteredTicks = hitNotes.ticks
      .filter(e => e.tick >= lineStartTick && e.tick <= lastLineTick && e.note !== 0);

    if (filteredTicks.length === 0) continue;

    const segments = [];
    let currentSegment = null;

    for (const { tick, note } of filteredTicks) {
      const baseY = Math.max(0, Math.min(SVG_HEIGHT - NOTE_HEIGHT, toneToY(note) - NOTE_HEIGHT / 2)) + NOTE_HEIGHT / 2;
      const { offset, count } = getOverlapInfo(tick, note, username);
      const clampedY = Math.max(NOTE_HEIGHT / 2, Math.min(SVG_HEIGHT - NOTE_HEIGHT / 2, baseY + offset));

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
        currentSegment.maxOverlap = Math.max(currentSegment.maxOverlap, count);
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
          maxOverlap: count,
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

  // Unique clip ID for this component instance
  const clipId = "cursor-clip";

  // --- Gap drag handlers (host only) ---
  // Dragging the cursor right = cursor should be further along in the line,
  // which means lyrics should start LATER in audio time, i.e. gap must DECREASE.
  //   tick = (bpm/60) * (sec - gap/1000)
  //   ∂tick/∂gap = -(bpm/60)/1000
  // So dGap_ms = -(dTicks * 60000 / bpm). Convert pixel drag to ticks via the
  // current line's horizontal scale.
  const canDragGap = isHost && gapData && typeof gapData.setGap === 'function';
  const bpm = tickData.lyricData?.bpm ?? 120;
  // One full lyric line worth of duration in ms — used for snap threshold & indicator.
  const lineDurationMs = (lineLengthInTicks * 60000) / bpm;

  const handleGapPointerDown = (e) => {
    if (!canDragGap) return;
    const rect = e.currentTarget.getBoundingClientRect();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDragState({
      startX: e.clientX,
      startGap: gapData.gap ?? 0,
      rectWidth: rect.width,
      currentDx: 0,
    });
  };

  const handleGapPointerMove = (e) => {
    if (!dragState) return;
    const dxPx = e.clientX - dragState.startX;
    // Convert pixels → ticks → ms. Drag right = cursor moves right = gap decreases.
    const dxFractionOfLine = dxPx / dragState.rectWidth;
    const dGapMs = -dxFractionOfLine * lineDurationMs;
    const newGap = Math.max(0, dragState.startGap + dGapMs);
    gapData.setGap(newGap);
    setDragState({ ...dragState, currentDx: dxPx });
  };

  const handleGapPointerUp = (e) => {
    if (!dragState) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    const dxPx = e.clientX - dragState.startX;
    // Ignore taps — require at least 4px of movement to count as a drag.
    if (Math.abs(dxPx) < 4) {
      gapData.setGap(dragState.startGap);
      setDragState(null);
      return;
    }
    const dxFractionOfLine = dxPx / dragState.rectWidth;
    // Snap: if dragged more than 33% of line width, snap to whole-line jumps.
    let finalGap;
    if (Math.abs(dxFractionOfLine) > 0.33) {
      const lines = Math.round(dxFractionOfLine);
      finalGap = Math.max(0, dragState.startGap - lines * lineDurationMs);
    } else {
      finalGap = Math.max(0, dragState.startGap - dxFractionOfLine * lineDurationMs);
    }
    gapData.setGap(finalGap);
    setDragState(null);
    // Persist to server
    if (songId) {
      fetch(`${apiUrl}/songs/${songId}`, {
        method: "PATCH",
        body: JSON.stringify({ gap: Math.floor(finalGap) }),
        headers: { "Content-Type": "application/json" },
      }).catch(() => {});
    }
  };

  // Visual indicator when past snap threshold
  const dragDxFraction = dragState ? dragState.currentDx / dragState.rectWidth : 0;
  const snapLines = Math.abs(dragDxFraction) > 0.33 ? Math.round(dragDxFraction) : 0;

  return (
    <div className="w-full mx-auto relative">
      <svg
        width="100%"
        viewBox={`0 0 ${width} ${SVG_HEIGHT}`}
        ref={ref}
        onPointerDown={canDragGap ? handleGapPointerDown : undefined}
        onPointerMove={dragState ? handleGapPointerMove : undefined}
        onPointerUp={dragState ? handleGapPointerUp : undefined}
        onPointerCancel={dragState ? handleGapPointerUp : undefined}
        style={canDragGap ? { cursor: dragState ? 'grabbing' : 'grab', touchAction: 'none' } : undefined}
      >
        <defs>
          {/* Clip path: everything left of the cursor */}
          <clipPath id={clipId}>
            <rect x={0} y={0} width={Math.max(0, cursorX)} height={SVG_HEIGHT} />
          </clipPath>
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

        {/* Expected note bars — dim "upcoming" layer (full width, reduced opacity) */}
        {expectedNotes.map((el, i) => {
          const noteX = tickToX(el.start);
          const noteW = (el.length / lineLengthInTicks) * width;
          const noteEndX = noteX + noteW;

          // Only render the dim portion for notes that extend past the cursor
          if (noteEndX <= cursorX) return null;

          return (
            <g key={`note-dim-${i}`} opacity={0.3}>
              {el.isSpecial && (
                <rect
                  x={noteX - 1}
                  y={toneToY(el.tone) - NOTE_HEIGHT / 2 - 1}
                  width={noteW + 2}
                  height={NOTE_HEIGHT + 2}
                  fill="none"
                  stroke="#FFD700"
                  strokeWidth="1.5"
                  rx={NOTE_HEIGHT / 2 + 1}
                  ry={NOTE_HEIGHT / 2 + 1}
                  opacity={0.4}
                />
              )}
              <rect
                x={noteX}
                y={toneToY(el.tone) - NOTE_HEIGHT / 2}
                width={noteW}
                height={NOTE_HEIGHT}
                fill={el.isSpecial ? "#b8860b" : "#b44aff"}
                stroke={el.isSpecial ? "rgba(255,215,0,0.2)" : "rgba(255,255,255,0.15)"}
                rx={NOTE_HEIGHT / 2}
                ry={NOTE_HEIGHT / 2}
              />
              {el.isSpecial && (
                <text
                  x={noteX + noteW / 2}
                  y={toneToY(el.tone) + 1}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize="6"
                  fill="rgba(255,255,255,0.4)"
                >
                  ★
                </text>
              )}
            </g>
          );
        })}

        {/* Expected note bars — bright "passed" layer (clipped to cursor) */}
        <g clipPath={`url(#${clipId})`}>
          {expectedNotes.map((el, i) => {
            const lineIdx = i + 1;
            const isCurrent = tickData.lyricRef.syllableIndex === lineIdx && !tickData.lyricRef.isSilent;
            const noteX = tickToX(el.start);
            const noteW = (el.length / lineLengthInTicks) * width;

            return (
              <g key={`note-bright-${i}`}>
                {el.isSpecial && (
                  <rect
                    x={noteX - 1}
                    y={toneToY(el.tone) - NOTE_HEIGHT / 2 - 1}
                    width={noteW + 2}
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
                  x={noteX}
                  y={toneToY(el.tone) - NOTE_HEIGHT / 2}
                  width={noteW}
                  height={NOTE_HEIGHT}
                  fill={el.isSpecial
                    ? (isCurrent ? "#FFD700" : "#b8860b")
                    : (isCurrent ? "#39ff14" : "#b44aff")
                  }
                  stroke={el.isSpecial ? "rgba(255,215,0,0.4)" : "rgba(255,255,255,0.3)"}
                  rx={NOTE_HEIGHT / 2}
                  ry={NOTE_HEIGHT / 2}
                />
                {el.isSpecial && (
                  <text
                    x={noteX + noteW / 2}
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
        </g>

        {/* Playback cursor */}
        <rect
          x={cursorX}
          y={0}
          width={3}
          height={SVG_HEIGHT}
          fill={isOnSpecialNote ? "rgba(255,215,0,0.8)" : "rgba(255,255,255,0.6)"}
        />
        {/* Cursor glow on special notes */}
        {isOnSpecialNote && (
          <rect
            x={cursorX - 4}
            y={0}
            width={11}
            height={SVG_HEIGHT}
            fill="rgba(255,215,0,0.15)"
            rx={5}
          />
        )}

        {/* Player hit-note continuous lines — clipped to cursor for smooth reveal */}
        <g clipPath={`url(#${clipId})`}>
          {Object.entries(playerSegments).map(([username, segments]) => {
            const hue = getRandInt(0, 360, username);
            const color = `hsl(${hue}, 100%, 55%)`;
            const glowColor = `hsl(${hue}, 100%, 70%)`;

            return segments.map((seg, si) => {
              // Scale down stroke widths when multiple players overlap
              const scale = seg.maxOverlap > 1 ? 0.6 : 1;

              if (seg.points.length < 2) {
                // Single point — draw a small circle
                const pt = seg.points[0];
                return (
                  <circle
                    key={`${username}-seg-${si}`}
                    cx={pt.x + tickWidth / 2}
                    cy={pt.y}
                    r={NOTE_HEIGHT * 0.4 * scale}
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
                    strokeWidth={NOTE_HEIGHT * 1.2 * scale}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  {/* Main line */}
                  <path
                    d={pathD}
                    fill="none"
                    stroke={seg.isSpecial ? "#FFD700" : color}
                    strokeWidth={NOTE_HEIGHT * 0.6 * scale}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    filter="url(#lineGlow)"
                  />
                  {/* Bright core */}
                  <path
                    d={pathD}
                    fill="none"
                    stroke={seg.isSpecial ? "#FFFACD" : glowColor}
                    strokeWidth={NOTE_HEIGHT * 0.2 * scale}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </g>
              );
            });
          })}
        </g>

        {/* Sparkle particles near cursor when hitting special notes */}
        <SparkleParticles
          active={isOnSpecialNote && Object.keys(hitNotesByPlayer).length > 0}
          cx={cursorX}
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

      {/* Gap drag snap indicator — shows prev/next line arrows when past threshold */}
      {dragState && snapLines !== 0 && (
        <div
          className={`absolute top-1/2 -translate-y-1/2 pointer-events-none px-3 py-2 rounded-lg bg-neon-purple/80 text-white font-bold text-sm shadow-lg ${
            snapLines > 0 ? 'right-4' : 'left-4'
          }`}
        >
          {snapLines > 0 ? '→ ' : '← '}
          {Math.abs(snapLines) === 1
            ? (snapLines > 0 ? t('gap.nextLine') : t('gap.prevLine'))
            : `${Math.abs(snapLines)} ${t('gap.lines')}`}
        </div>
      )}
      {/* Gap drag hint — small label while dragging */}
      {dragState && (
        <div className="absolute top-1 left-1/2 -translate-x-1/2 pointer-events-none px-2 py-1 rounded bg-black/70 text-neon-purple text-xs font-mono">
          {t('gap.dragToFix')}: {Math.floor(gapData?.gap ?? 0)} {t('gap.ms')}
        </div>
      )}
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
