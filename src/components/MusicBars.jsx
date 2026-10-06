import React, { useRef, useState, useEffect, useLayoutEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { playerHue } from "../logic/playerColor";
import { getAvatarSprite, onAvatarReady } from "../logic/avatarSprite";
import { avatarSrc, tieLetters } from "../logic/avatar";
import { foldNotes } from "../logic/octaveFold";
import { buildSegments } from "../logic/noteSegments";
import { graceIntervals, singerNotesOnLine } from "../logic/singerNotes";
import { highwayWindow, previousLineEnd, cursorAlpha, countdown, LEAD_IN_SHARE } from "../logic/highwayWindow";
import { createFrameGovernor } from "../logic/frameGovernor";
import { HEIGHT } from "../logic/glScene";
import { offThreadPainting, createOffThreadPainter, createMainThreadPainter, highwayStats } from "../logic/highwayRenderer";
import { layerScale, maxLayerSize } from "../logic/canvasScale";
import useMeasure from "react-use-measure";

// The frame governor's levels (frameGovernor.js): a WebGL canvas is a
// compositor layer of its own, which the compositor scales, so a device that
// cannot keep up gets fewer pixels (2, then 1.5 per CSS pixel), but never
// fewer frames: a frame costs the main thread its scene (and, painted there,
// a few dozen WebGL calls), so skipping frames bought the page next to nothing
// and made the highway judder (a Moto Z, whose page runs at ~32 frames a
// second for reasons of its own, fell to every 3rd: 11-17 a second). A frame
// the worker has not finished is still skipped.
const GL_LEVELS = [{ divisor: 1 }, { divisor: 1, scale: 2 }, { divisor: 1, scale: 1.5 }];
const createGovernor = () => createFrameGovernor({ levels: GL_LEVELS });

/**
 * The pitch "note highway": expected notes of the current lyric line, the
 * playback cursor and every player's sung pitch as glowing lines.
 *
 * Drawn on a <canvas>, driven straight from the live store (see liveStore.js):
 * a frame is one imperative paint of a few hundred primitives and touches no
 * DOM, which is what keeps it cheap on old phones. React only renders the
 * container, the drag overlays and the show/hide state. The frame is built
 * here as a WebGL scene (glScene.js) and drawn with WebGL, in a worker where
 * the browser can, else on the main thread (highwayRenderer.js).
 */

// Fixed vertical range in semitones. Every line uses the same span so that
// being off by N semitones always looks the same visually, regardless of how
// narrow/wide the expected notes in the current line are.
const VISIBLE_SEMITONES = 24;
const NOTE_HEIGHT = HEIGHT / VISIBLE_SEMITONES; // px per semitone

// Feedback thresholds (consecutive hit ticks on the correct note)
const GREAT_THRESHOLD = 8;
const AWESOME_THRESHOLD = 16;

const COLOR_P1 = "#b44aff";
const COLOR_P1_CURRENT = "#39ff14";
const COLOR_SPECIAL = "#b8860b";
const COLOR_SPECIAL_CURRENT = "#FFD700";
const COLOR_P2 = "#ff8c42";
const COLOR_P2_CURRENT = "#ffaa00";
const GOLD_LINE = ["rgba(255,215,0,0.4)", "#FFD700", "#FFFACD"]; // a sung golden note: halo, line, core
const TAG_FONT = "bold 12px sans-serif";
// The countdown after a long break (highwayWindow.js): a ring in the sign's
// pink that empties clockwise over the last 3 s, on a dark disc with the
// seconds, just left of the first note, so the cursor comes out of it onto the
// note as it empties. As big as the room left of the note allows (a phone's
// is ~45 px), at most 21 px
const ringRadius = width => Math.max(14, Math.min(21, (width * LEAD_IN_SHARE) / 2 - 4));
const RING_TRACK = [2.5]; // the full ring, dim, behind
const RING_WIDTHS = [8, 3.5, 1.2]; // halo, line, core (the widest first: the WebGL path pads by it)

// ---------------------------------------------------------------------------
// Per-line geometry (rebuilt only when the lyric line or the width changes)
// ---------------------------------------------------------------------------

/** A track is "singing" when the cursor is within ~3s of its current line. */
const isNearLine = (line, tf, bufferTicks) => {
  const start = line[1].start;
  const lastEl = line[line.length - 1];
  const end = lastEl.start + lastEl.length;
  return tf >= start - bufferTicks && tf <= end + bufferTicks;
};

/**
 * Minimum visible line length in ticks, from the song's median line length,
 * so short lines don't fly past. Depends only on the song.
 */
function medianMinTickLength(lyricLines) {
  if (!lyricLines || lyricLines.length <= 2) return null;
  const lineLengths = lyricLines
    .filter(line => line.length > 1 && !line[1].isBreak)
    .map(line => {
      const last = line[line.length - 1];
      return (last.start + last.length) - line[1].start;
    })
    .sort((a, b) => a - b);
  if (lineLengths.length === 0) return null;
  const median = lineLengths[Math.floor(lineLengths.length / 2)];
  return Math.round(median * 0.6);
}

function buildLineGeometry({ p1Line, p2Line, p1Singing, p2Singing, p1PrevEnd, p2PrevEnd, minTickLength, width, bpm }) {
  // --- Vertical range: fixed span, centered on both tracks' midpoint ---
  const p1Tones = p1Singing ? p1Line.filter(e => !e.isBreak).map(e => e.tone) : [];
  const p2Tones = p2Singing ? p2Line.filter(e => !e.isBreak).map(e => e.tone) : [];
  const allTones = [...p1Tones, ...p2Tones];
  const minTone = Math.min(...allTones);
  const maxTone = Math.max(...allTones);
  const midTone = (minTone + maxTone) / 2;
  const lowerBound = midTone - VISIBLE_SEMITONES / 2;
  const upperBound = midTone + VISIBLE_SEMITONES / 2;

  // --- Horizontal range: P1's and P2's lines together, the first note the
  // same share of the width in on every line (the cursor's run-up), short
  // lines widened to the minimum (highwayWindow.js) ---
  const parts = [];
  if (p1Singing) parts.push({ line: p1Line, prevEnd: p1PrevEnd });
  if (p2Singing) parts.push({ line: p2Line, prevEnd: p2PrevEnd });
  const { startTick: lineStartTick, endTick: lastLineTick, firstTick, leadTicks, prevEnd } = highwayWindow(parts, { minLength: minTickLength });
  const lineLengthInTicks = lastLineTick - lineStartTick;

  const expectedNotes = p1Singing ? p1Line.filter(el => !el.isBreak) : [];
  const p2ExpectedNotes = p2Singing ? p2Line.filter(el => !el.isBreak) : [];
  const graceTicks = (bpm / 60) * 1.0; // 1 second in ticks
  const firstNote = [...expectedNotes, ...p2ExpectedNotes].find(el => el.start === firstTick);

  return {
    width,
    midTone, lowerBound, upperBound,
    lineStartTick, lastLineTick, lineLengthInTicks,
    firstTick, leadTicks, // the first note of either part, which the cursor runs up to, and how long its run-up is
    firstTone: firstNote?.tone ?? midTone,
    prevEnd, // where the singing before ended: a long break gets a countdown
    expectedNotes, p2ExpectedNotes,
    // Where a singer's pitch is shown: within a second of a note of their own part
    grace: graceIntervals(expectedNotes, graceTicks),
    p2Grace: graceIntervals(p2ExpectedNotes, graceTicks),
    lineDurationMs: (lineLengthInTicks * 60000) / bpm,
    // Map a tone value to canvas y (higher tones → lower y / higher on screen)
    toneToY: tone => HEIGHT - ((tone - lowerBound) / (upperBound - lowerBound)) * HEIGHT,
    // Map a tick to canvas x
    tickToX: tick => ((tick - lineStartTick) / lineLengthInTicks) * width,
    tickWidth: width / lineLengthInTicks,
    noteWidth: el => (el.length / lineLengthInTicks) * width,
  };
}

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------

/** What only changes with the line: the backdrop, the semitone grid and the dim expected notes. */
function paintLineContent(P, geom) {
  P.backdrop();

  // Semitone grid
  for (let i = 0; i <= VISIBLE_SEMITONES; i++) {
    const tone = geom.lowerBound + i;
    const isOctave = Math.round(tone) % 12 === 0;
    P.line(0, geom.toneToY(tone), geom.width, isOctave ? 1 : 0.5, isOctave ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.04)");
  }

  // Expected notes: dim "upcoming" layer, full width
  P.group(() => {
    for (const el of geom.p2ExpectedNotes) noteRect(P, geom, el, COLOR_P2, "rgba(255,140,66,0.15)", 0.25);
    for (const el of geom.expectedNotes) {
      if (el.isSpecial) specialOutline(P, geom, el, 0.3 * 0.4, false);
      noteRect(P, geom, el, el.isSpecial ? COLOR_SPECIAL : COLOR_P1, el.isSpecial ? "rgba(255,215,0,0.2)" : "rgba(255,255,255,0.15)", 0.3);
      if (el.isSpecial) star(P, geom, el, "rgba(255,255,255,0.4)");
    }
  });
}

function noteRect(P, geom, el, fill, stroke, alpha = 1) {
  P.noteRect(geom.tickToX(el.start), geom.toneToY(el.tone) - NOTE_HEIGHT / 2, geom.noteWidth(el), NOTE_HEIGHT, NOTE_HEIGHT / 2, fill, stroke, alpha, !!el.isRap);
}

function specialOutline(P, geom, el, alpha, withHalo) {
  P.specialOutline(geom.tickToX(el.start) - 1, geom.toneToY(el.tone) - NOTE_HEIGHT / 2 - 1, geom.noteWidth(el) + 2, NOTE_HEIGHT + 2, NOTE_HEIGHT / 2 + 1, alpha, withHalo);
}

function star(P, geom, el, color) {
  P.star(geom.tickToX(el.start) + geom.noteWidth(el) / 2, geom.toneToY(el.tone) + 1, color);
}

// ---------------------------------------------------------------------------

// Canvases handed to a worker: they cannot be drawn on here any more, nor handed over twice
const transferred = new WeakSet();

const MusicBars = ({ store, isHost, playerColors, playerParts, scores, gapDragEnabled, setGap, onClick }) => {
  const scoresRef = useRef(scores);
  scoresRef.current = scores || {};
  const partsRef = useRef(playerParts); // username -> 1 | 2: a duet's second-part singers are judged against its notes
  partsRef.current = playerParts || {};
  const { t } = useTranslation();
  const [measureRef, bounds] = useMeasure();
  const canvasRef = useRef(null);
  const widthRef = useRef(0);
  widthRef.current = bounds.width || 0;
  const colorsRef = useRef(playerColors);
  colorsRef.current = playerColors || {};

  // Bars are hidden between sections (solo mode) — a rare state change
  const [visible, setVisible] = useState(false);
  const visibleRef = useRef(false);

  // Caches that survive frames
  const geomRef = useRef({ key: null, geom: null });
  const medianRef = useRef({ lines: null, value: null });
  const tagsRef = useRef(new Map()); // username -> a score tag's text and width, while its score stays
  const particlesRef = useRef([]);
  const governorRef = useRef(null); // fewer pixels while the page cannot keep up (GL_LEVELS)
  if (!governorRef.current) governorRef.current = createGovernor();
  const painterRef = useRef(null); // what draws the canvas, in a worker or here (highwayRenderer.js); none without WebGL2
  const owedStepsRef = useRef(0); // frames skipped while the worker was busy, for the sparkles
  const paintCountRef = useRef({ n: 0, at: 0 }); // paints per second, for ?debug
  const [canvasKey, setCanvasKey] = useState(0); // a new <canvas> when the old one was lost (a failed worker, a lost context)
  const particleIdRef = useRef(0);
  const lastSpawnRef = useRef(0);

  // --- Gap drag state (host only) ---
  // Drag the cursor left/right to shift the gap. Past a threshold, snap to
  // prev/next lyric line ("iPhone page-snap"). Live-previews via setGap;
  // user must click Save in GapCorrector to persist to server.
  const [dragState, setDragState] = useState(null); // { startX, startGap, currentDx, rectWidth }
  const justDraggedRef = useRef(false); // a gap drag ends with a click event that must not count as a tap
  const handleClick = () => {
    if (justDraggedRef.current) { justDraggedRef.current = false; return; }
    onClick?.();
  };
  const dragRef = useRef(null);
  dragRef.current = dragState;
  const canDragGap = gapDragEnabled === true && isHost && typeof setGap === 'function';

  const currentGap = () => Number(store.frame.tickData?.lyricData?.gap) || 0;

  /**
   * One frame. Called on every live-store update (`governed`: one animation
   * frame, which the frame governor may skip) and on resize.
   */
  const draw = useCallback((governed) => {
    const canvas = canvasRef.current;
    const width = widthRef.current;
    const { tickData, p2TickData } = store.frame;
    const notesByPlayer = store.notes;

    // --- Which tracks are singing? ---
    const p1Line = tickData?.currentLine;
    const p2Line = p2TickData?.currentLine;
    const p1Active = !!(p1Line?.[1]);
    const p2Active = !!(p2Line?.[1]);
    const bpm = tickData?.lyricData?.bpm ?? p2TickData?.lyricData?.bpm ?? 120;
    const bufferTicks = (bpm / 60) * 3;
    const tickFloat = tickData?.tickFloat ?? 0;
    // (on the clamped tick, so a chart whose first note is at tick 0 keeps its
    // highway up through the intro, as it always has; the cursor uses the real one)
    let p1Singing = p1Active && isNearLine(p1Line, tickFloat, bufferTicks);
    let p2Singing = p2Active && isNearLine(p2Line, tickFloat, bufferTicks);
    if (!p1Singing && !p2Singing && p2TickData) {
      // Duet mode: keep showing the finished section instead of flashing out
      if (p1Active) p1Singing = true;
      if (p2Active) p2Singing = true;
    }
    const nowVisible = p1Singing || p2Singing;
    if (nowVisible !== visibleRef.current) {
      visibleRef.current = nowVisible;
      setVisible(nowVisible);
    }
    // The frame governor (frameGovernor.js) counts the frames to see whether the
    // page keeps up. `steps`: the frames this paint stands for, which the
    // sparkles move on by.
    let steps = governed ? governorRef.current.frame(performance.now()) : 1;
    const painter = painterRef.current;
    if (!nowVisible || !canvas || !painter || width <= 0 || steps === 0) return;

    // --- Geometry (cached per line + width) ---
    const lyricLines = (p1Singing ? tickData : p2TickData)?.lyricData?.lyricLines;
    if (medianRef.current.lines !== lyricLines) {
      medianRef.current = { lines: lyricLines, value: medianMinTickLength(lyricLines) };
    }
    const key = `${p1Singing ? 1 : 0}${p2Singing ? 1 : 0}|${width}|${bpm}`;
    const g = geomRef.current;
    if (g.key !== key || g.p1Line !== p1Line || g.p2Line !== p2Line) {
      geomRef.current = {
        key, p1Line, p2Line,
        geom: buildLineGeometry({
          p1Line, p2Line, p1Singing, p2Singing, minTickLength: medianRef.current.value, width, bpm,
          // where each part's line before ended: the window starts no earlier
          p1PrevEnd: previousLineEnd(tickData?.lyricData?.lyricLines, tickData?.lyricRef?.lineIndex),
          p2PrevEnd: previousLineEnd(p2TickData?.lyricData?.lyricLines, p2TickData?.lyricRef?.lineIndex),
        }),
      };
    }
    const geom = geomRef.current.geom;
    const { midTone, lineStartTick, lastLineTick, lineLengthInTicks, expectedNotes, p2ExpectedNotes, grace, p2Grace, toneToY, tickToX, tickWidth } = geom;

    // --- Canvas size (the renderer resizes it) ---
    // Within the GPU's texture limit, and fewer pixels when the governor says
    // the device cannot keep up (canvasScale.js)
    const deviceRatio = window.devicePixelRatio || 1;
    const maxSize = maxLayerSize();
    const dpr = layerScale({ dpr: deviceRatio, cssWidth: width, cssHeight: HEIGHT, maxSize, cap: governorRef.current.scale });
    const pw = Math.round(width * dpr);
    const ph = Math.round(HEIGHT * dpr);
    // the scene for the next frame, unless the worker still paints the last one
    const P = painter.begin(pw, ph, dpr);
    if (!P) {
      owedStepsRef.current += steps;
      if (!painter.ready) return; // the worker is still starting
      // that frame does not show: the governor counts what the worker manages
      if (governed) governorRef.current.dropped();
      highwayStats.dropped++;
      return;
    }
    steps += owedStepsRef.current;
    owedStepsRef.current = 0;
    const pc = paintCountRef.current;
    const nowMs = performance.now();
    pc.n++;
    if (nowMs - pc.at >= 1000) {
      Object.assign(highwayStats, { mode: painter.mode, width: pw, height: ph, scale: dpr, dpr: deviceRatio, maxSize, level: governorRef.current.level, fps: Math.round((pc.n * 1000) / (nowMs - pc.at)) });
      pc.n = 0;
      pc.at = nowMs;
    }
    paintLineContent(P, geom);

    // --- Cursor ---
    // At the moment itself, which runs on below tick 0 before the gap (the
    // clamped tick stood on a first note at tick 0 through the whole intro):
    // so the cursor comes in from the left edge and meets the first note as
    // it is to be sung (highwayWindow.js)
    const nowTick = tickData.rawTickFloat ?? tickFloat;
    const cursorX = ((nowTick - lineStartTick) / lineLengthInTicks) * width;
    const cursorTick = Math.floor(nowTick);
    const lyricData = tickData.lyricData;
    const currentRef = p1Singing ? lyricData?.lyricRefs?.[cursorTick] : null;
    const currentSyllable = currentRef && !currentRef.isSilent
      ? lyricData?.lyricLines?.[currentRef.lineIndex]?.[currentRef.syllableIndex]
      : null;
    const isOnSpecialNote = currentSyllable?.isSpecial ?? false;
    const p1CurrentIdx = p1Singing && tickData.lyricRef && !tickData.lyricRef.isSilent ? tickData.lyricRef.syllableIndex : -1;
    const p2CurrentIdx = p2Singing && p2TickData.lyricRef && !p2TickData.lyricRef.isSilent ? p2TickData.lyricRef.syllableIndex : -1;

    // --- Everything left of the cursor: bright expected notes + player lines ---
    // Cut off at the cursor; bright notes that start a pixel past it, which
    // the clip hides, are not drawn at all.
    const clipX = Math.max(0, cursorX);
    const hiddenX = (Math.ceil(clipX * dpr) + 1) / dpr; // what starts right of here is clipped away
    P.beginClip(clipX);

    P.group(() => {
      p2ExpectedNotes.forEach((el, i) => {
        const x = tickToX(el.start);
        if (x - 0.5 >= hiddenX) return;
        noteRect(P, geom, el, i + 1 === p2CurrentIdx ? COLOR_P2_CURRENT : COLOR_P2, "rgba(255,140,66,0.3)");
      });
      expectedNotes.forEach((el, i) => {
        const x = tickToX(el.start);
        const reach = el.isSpecial ? 3.5 : 0.5; // the golden halo is 5 px wide around a box 1 px out
        if (x - reach >= hiddenX) return;
        const isCurrent = i + 1 === p1CurrentIdx;
        if (el.isSpecial) specialOutline(P, geom, el, isCurrent ? 1 : 0.5, true);
        noteRect(P, geom, el,
          el.isSpecial ? (isCurrent ? COLOR_SPECIAL_CURRENT : COLOR_SPECIAL) : (isCurrent ? COLOR_P1_CURRENT : COLOR_P1),
          el.isSpecial ? "rgba(255,215,0,0.4)" : "rgba(255,255,255,0.3)");
        if (el.isSpecial) star(P, geom, el, "rgba(255,255,255,0.7)");
      });
    });

    // --- Players' notes inside the visible window ---
    // Each singer's notes are shown within a second of a note of their own
    // part and hidden in its quiet stretches (singerNotes.js): a duet's
    // second-part singer along the second part's notes, judged against them.
    const ticksPerSec = lyricData.bpm / 60;
    const gapSec = lyricData.gap / 1000;
    const notesByTick = {}; // rounded tick → [{ username, semitone }] for overlap detection
    const perPlayer = [];
    for (const username in notesByPlayer) {
      const part = partsRef.current[username] === 2 && p2TickData?.lyricData ? 2 : 1;
      const chart = part === 2 ? p2TickData.lyricData : lyricData;
      const visibleNotes = singerNotesOnLine(notesByPlayer[username].notes, {
        chart, grace: part === 2 ? p2Grace : grace, lineStartTick, lastLineTick, ticksPerSec, gapSec,
      });
      if (!visibleNotes.length) continue;

      // Octave folding (charts are octave-agnostic): each note toward its own
      // target, hysteresis only for ambiguous notes — see octaveFold.js.
      const shifts = foldNotes(visibleNotes, { midTone });
      visibleNotes.forEach((v, i) => {
        v.semitone = v.raw + shifts[i];
        (notesByTick[Math.round(v.tf)] ||= []).push({ username, semitone: v.semitone });
      });
      perPlayer.push({ username, chart, visibleNotes });
    }

    const overlapInfo = (roundedTick, semitone, username) => {
      const atTick = notesByTick[roundedTick];
      if (!atTick || atTick.length <= 1) return { offset: 0, count: 1 };
      const overlapping = atTick.filter(e => Math.abs(e.semitone - semitone) <= 1);
      if (overlapping.length <= 1) return { offset: 0, count: 1 };
      const myIdx = overlapping.findIndex(e => e.username === username);
      if (myIdx < 0) return { offset: 0, count: 1 };
      const spread = NOTE_HEIGHT * 0.4;
      const center = (overlapping.length - 1) / 2;
      return { offset: (myIdx - center) * spread, count: overlapping.length };
    };

    const feedback = []; // { username, text, x, y }
    for (const { username, chart, visibleNotes } of perPlayer) {
      // Place each note and classify it against the chart, then group into
      // continuous line segments (gold only where a golden note is overlapped)
      const points = visibleNotes.map(({ tf, rawSemitone, semitone }) => {
        const baseY = Math.max(0, Math.min(HEIGHT - NOTE_HEIGHT, toneToY(semitone) - NOTE_HEIGHT / 2)) + NOTE_HEIGHT / 2;
        const { offset, count } = overlapInfo(Math.round(tf), semitone, username);
        const y = Math.max(NOTE_HEIGHT / 2, Math.min(HEIGHT - NOTE_HEIGHT / 2, baseY + offset));

        // Hit = within ±1 semitone of the expected tone at this tick
        const tick = Math.floor(Math.max(0, tf));
        const ref = chart?.lyricRefs?.[tick];
        const syllable = ref && !ref.isSilent ? chart?.lyricLines?.[ref.lineIndex]?.[ref.syllableIndex] : null;
        const expectedTone = syllable?.tone;
        const isHit = expectedTone !== undefined && (syllable.isRap || Math.abs(semitone - expectedTone) <= 1);
        return { tf, x: tickToX(tf), y, rawSemitone, semitone, isHit, isSpecial: syllable?.isSpecial ?? false, count };
      });
      const segments = buildSegments(points);

      const hue = playerHue(colorsRef.current, username);
      const color = `hsl(${hue}, 100%, 55%)`;
      const coreColor = `hsl(${hue}, 100%, 70%)`;
      const haloColor = `hsla(${hue}, 100%, 50%, 0.3)`;

      for (const s of segments) {
        const scale = s.maxOverlap > 1 ? 0.6 : 1;
        if (s.points.length < 2) {
          const pt = s.points[0];
          P.dot(pt.x + tickWidth / 2, pt.y,
            NOTE_HEIGHT * 0.7 * scale, s.isSpecial ? "rgba(255,215,0,0.3)" : haloColor,
            NOTE_HEIGHT * 0.4 * scale, s.isSpecial ? "#FFD700" : color);
          continue;
        }
        // Three strokes (wide halo, main line, bright core) give the glow
        P.pitchLine(s.points, tickWidth / 2,
          [NOTE_HEIGHT * 1.2 * scale, NOTE_HEIGHT * 0.6 * scale, NOTE_HEIGHT * 0.2 * scale],
          s.isSpecial ? GOLD_LINE : [haloColor, color, coreColor]);
      }

      // Feedback text for the latest active segment
      // (a singer's notes end a little behind the cursor: their delay is taken off, PartyPage)
      const active = segments.find(s => s.endTick >= cursorTick - Math.max(2, Math.ceil(0.5 * ticksPerSec)) && s.startTick <= cursorTick);
      if (active && active.hitCount >= GREAT_THRESHOLD) {
        const lastPt = active.points[active.points.length - 1];
        feedback.push({ hue, text: active.hitCount >= AWESOME_THRESHOLD ? "AWESOME!" : "GREAT!", x: lastPt.x, y: lastPt.y - 20 });
      }
    }
    P.endClip(); // end cursor clip

    // --- Cursor --- (a little dimmer on its run-up to the first note)
    if (isOnSpecialNote) P.fillRoundRect(cursorX - 4, 0, 11, HEIGHT, 5, "rgba(255,215,0,0.15)");
    P.fillRect(cursorX, 0, 3, HEIGHT, isOnSpecialNote ? "rgba(255,215,0,0.8)" : `rgba(255,255,255,${cursorAlpha(nowTick, geom.firstTick, geom.leadTicks)})`);

    // --- Sparkle particles near the cursor while hitting a special note ---
    const now = performance.now();
    const particles = particlesRef.current;
    if (isOnSpecialNote && perPlayer.length > 0 && now - lastSpawnRef.current > 80) {
      lastSpawnRef.current = now;
      const cy = currentSyllable ? toneToY(currentSyllable.tone) : HEIGHT / 2;
      const count = 1 + Math.floor(Math.random() * 2);
      for (let i = 0; i < count; i++) {
        particles.push({
          id: particleIdRef.current++,
          x: cursorX + (Math.random() - 0.5) * 30,
          y: cy + (Math.random() - 0.5) * 20,
          vx: (Math.random() - 0.5) * 1.5,
          vy: -(0.3 + Math.random() * 1.2),
          size: 1 + Math.random() * 2.5,
          life: 1,
          decay: 0.015 + Math.random() * 0.02,
          hue: 40 + Math.random() * 30, // gold range
        });
      }
    }
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx * steps; p.y += p.vy * steps; p.life -= p.decay * steps;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      P.circle(p.x, p.y, p.size * p.life, `hsla(${p.hue}, 100%, 75%, ${p.life * 0.8})`);
    }

    // Backdrop, notes, lines and cursor fade out at the sides; the labels drawn from
    // here on (feedback, name tags, your rank) stay crisp
    P.fade(width);

    // --- Countdown to the first note after a long break (the intro too) ---
    const cd = countdown(nowTick, { firstTick: geom.firstTick, prevEnd: geom.prevEnd, songStartTick: -gapSec * ticksPerSec, ticksPerSec });
    if (cd) {
      const R = ringRadius(width);
      const cx = Math.max(R + 4, tickToX(geom.firstTick) - R - 6);
      const cy = Math.max(R + 6, Math.min(HEIGHT - R - 6, toneToY(geom.firstTone)));
      const a = cd.alpha;
      const al = k => Math.round(k * a * 100) / 100; // (a few dozen colour strings, not one per frame)
      P.fillRoundRect(cx - R, cy - R, 2 * R, 2 * R, R, `rgba(10,10,26,${al(0.7)})`);
      P.arc(cx, cy, R, 0, 2 * Math.PI, RING_TRACK, [`rgba(192,75,255,${al(0.35)})`]);
      P.arc(cx, cy, R, -Math.PI / 2 + (1 - cd.share) * 2 * Math.PI, 1.5 * Math.PI, RING_WIDTHS,
        [`rgba(255,92,214,${al(0.3)})`, `rgba(255,92,214,${a})`, `rgba(255,224,247,${a})`]);
      // each second's digit comes in bright and dims as it runs out: the tick
      P.text(String(cd.digit), cx, cy + 1, { font: R > 17 ? "bold 20px sans-serif" : "bold 17px sans-serif", align: "center", baseline: "middle", fill: "#ffffff", alpha: a * (0.6 + 0.4 * (cd.left - Math.floor(cd.left) || 1)) });
    }

    // --- Feedback text ("GREAT!", "AWESOME!") ---
    for (const fb of feedback) {
      if (fb.text === "AWESOME!") {
        // pulse like the old animate-pulse class
        P.text(fb.text, fb.x, fb.y, {
          font: "bold 16px sans-serif", align: "center", baseline: "middle", fill: "#FFD700",
          stroke: "rgba(255,215,0,0.3)", lineWidth: 3, alpha: 0.75 + 0.25 * Math.sin(now / 160),
        });
      } else {
        P.text(fb.text, fb.x, fb.y, { font: "bold 13px sans-serif", align: "center", baseline: "middle", fill: `hsl(${fb.hue}, 100%, 80%)` });
      }
    }

    // --- Score tags: each singer's avatar + score rides along their pitch line
    // at the cursor; whoever is not singing right now is listed, dimmed, at
    // the bottom left. This is the scoreboard. The avatar (their profile
    // picture, or the first letter of the name on their colour) says who it
    // is, so the names stay off the highway.
    const scores = scoresRef.current;
    const liveScores = store.scores ?? {}; // rode along with the notes, newer than the JSON board
    const lanes = store.lanes ?? null; // past the lane count: who the server put on screen
    const recentTicks = 1.5 * ticksPerSec;
    const placed = []; // tag centres already used, so neighbours stack instead of overlapping
    const TAG_H = 22; // the avatar is a circle as tall as the tag, at its left end
    const avatars = store.avatars ?? {};
    const avatarPx = Math.round(TAG_H * dpr); // sprites are drawn at device pixels, so they stay sharp
    // (The avatar, an avatarSprite.js sprite, goes to the renderer once: PictureLedger, glScene.js)
    const drawTag = (username, x, y, align, alpha, letters) => {
      const score = liveScores[username] ?? scores[username]?.score;
      const pin = lanes?.pinned.includes(username) ? "★" : "";
      const label = p2TickData ? `${pin}P${partsRef.current[username] ?? 1}` : pin; // two parts on stage: say which
      // toLocaleString and measureText were the most expensive calls of a
      // frame (a few µs each, for every tag): both only change with the score
      const hue = playerHue(colorsRef.current, username);
      let tag = tagsRef.current.get(username);
      if (!tag || tag.score !== score || tag.label !== label) {
        if (tagsRef.current.size > 256) tagsRef.current.clear();
        const text = [label, score !== undefined ? score.toLocaleString() : ""].filter(Boolean).join(" ");
        tag = { score, label, text, w: TAG_H + (text ? P.measure(text, TAG_FONT) + 11 : 0) };
        tagsRef.current.set(username, tag);
      }
      const { text, w } = tag;
      let ty = Math.max(TAG_H / 2, Math.min(HEIGHT - TAG_H / 2, y));
      for (const p of placed) if (Math.abs(p - ty) < TAG_H) ty = p + TAG_H;
      ty = Math.min(HEIGHT - TAG_H / 2, ty);
      placed.push(ty);
      // right of the cursor line when there is no room to its left
      const tx = align === "right" ? (x - w >= 4 ? x - w : x + 16) : x;
      P.box(tx, ty - TAG_H / 2, w, TAG_H, TAG_H / 2, "rgba(10,10,26,0.75)", `hsla(${hue}, 100%, 60%, 0.8)`, alpha);
      if (text) P.text(text, tx + TAG_H + 5, ty + 0.5, { font: TAG_FONT, align: "left", baseline: "middle", fill: `hsl(${hue}, 100%, 82%)`, alpha });
      P.image(getAvatarSprite({ username, src: avatarSrc(avatars[username]), hue, px: avatarPx, letters }), tx, ty - TAG_H / 2, TAG_H, TAG_H, alpha);
    };
    // Who gets a tag: the singers at the cursor, then the quiet list. Named
    // first, drawn after, so two who would look the same (no picture, same
    // letter, same colour) both get two letters (tieLetters)
    const singing = []; // [username, y]
    const tagged = new Set();
    for (const { username, visibleNotes } of perPlayer) {
      const last = visibleNotes[visibleNotes.length - 1];
      if (!last || cursorTick - last.tf > recentTicks) continue;
      singing.push([username, toneToY(last.semitone)]);
      tagged.add(username);
    }
    // In a crowd the quiet list is the lanes, not everyone who ever sang
    const listed = lanes ? [...lanes.pinned, ...lanes.spotlight] : new Set([...Object.keys(scores), ...Object.keys(liveScores)]);
    const quiet = [];
    for (const username of listed) if (!tagged.has(username)) quiet.push(username);
    const ties = tieLetters([...tagged, ...quiet], (u) => playerHue(colorsRef.current, u), (u) => Boolean(avatars[u]));
    // (tags never overlap each other: they are stacked, see drawTag)
    P.group(() => {
      for (const [username, y] of singing) drawTag(username, cursorX - 8, y, "right", 0.95, ties?.get(username));
      quiet.forEach((username, idle) => {
        drawTag(username, Math.max(56, width * 0.06), HEIGHT - 12 - idle * (TAG_H + 2), "left", 0.7, ties?.get(username));
      });
      // Your own place in that crowd
      const standing = store.standing;
      if (lanes && standing) {
        P.text(`#${standing.rank} / ${standing.total}`, width - 10, 8, { font: "bold 13px sans-serif", align: "right", baseline: "top", fill: "rgba(255,255,255,0.85)" });
      }
    });
    painter.end();
  }, [store]);

  // Paint in a worker where the browser can, else here (highwayRenderer.js).
  // Before the first frame: a canvas that has been drawn on cannot be handed over.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    if (transferred.has(canvas)) {
      // React's StrictMode runs effects twice; the first run took this element
      setCanvasKey(k => k + 1);
      return undefined;
    }
    // The canvas is lost (to a failed worker, or with its context): a new
    // element, painted on the main thread
    const lost = () => {
      painterRef.current = null;
      setCanvasKey(k => k + 1);
    };
    let painter = null;
    if (offThreadPainting()) {
      try {
        painter = createOffThreadPainter(canvas, lost);
        transferred.add(canvas);
      } catch { /* not transferable after all: painted here */ }
    }
    painter ??= createMainThreadPainter(canvas, lost);
    painterRef.current = painter;
    governorRef.current = createGovernor();
    owedStepsRef.current = 0;
    return () => {
      painter?.destroy();
      if (painterRef.current === painter) painterRef.current = null;
    };
  }, [canvasKey]);

  // Redraw on every live-store update, and whenever the container is resized
  useEffect(() => store.subscribe(() => draw(!store.frame.idle)), [store, draw]); // (an idle frame is no frame rate)
  useEffect(() => { draw(false); }, [draw, bounds.width, visible, canvasKey]); // (a new canvas shows a paused line at once)
  // A profile picture that arrives while nothing moves (paused) shows at once
  useEffect(() => onAvatarReady(() => draw(false)), [draw]);

  // --- Gap drag handlers (host only) ---
  // Dragging the cursor right = cursor should be further along in the line,
  // which means lyrics should start LATER in audio time, i.e. gap must DECREASE.
  //   tick = (bpm/60) * (sec - gap/1000)  →  dGap_ms = -(dTicks * 60000 / bpm)
  const lineDurationMs = () => geomRef.current.geom?.lineDurationMs ?? 0;

  const handleGapPointerDown = (e) => {
    if (!canDragGap) return;
    const rect = e.currentTarget.getBoundingClientRect();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDragState({ startX: e.clientX, startGap: currentGap(), rectWidth: rect.width, currentDx: 0 });
  };

  const handleGapPointerMove = (e) => {
    const ds = dragRef.current;
    if (!ds) return;
    const dxPx = e.clientX - ds.startX;
    // Convert pixels → ticks → ms. Drag right = cursor moves right = gap decreases.
    const dGapMs = -(dxPx / ds.rectWidth) * lineDurationMs();
    setGap(Math.max(0, ds.startGap + dGapMs));
    setDragState({ ...ds, currentDx: dxPx });
  };

  const handleGapPointerUp = (e) => {
    const ds = dragRef.current;
    if (!ds) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    const dxPx = e.clientX - ds.startX;
    // Ignore taps — require at least 4px of movement to count as a drag.
    if (Math.abs(dxPx) < 4) {
      setGap(ds.startGap);
      setDragState(null);
      return;
    }
    justDraggedRef.current = true;
    const dxFractionOfLine = dxPx / ds.rectWidth;
    // Snap: if dragged more than 33% of line width, snap to whole-line jumps.
    const finalGap = Math.abs(dxFractionOfLine) > 0.33
      ? Math.max(0, ds.startGap - Math.round(dxFractionOfLine) * lineDurationMs())
      : Math.max(0, ds.startGap - dxFractionOfLine * lineDurationMs());
    setGap(finalGap);
    setDragState(null);
  };

  // Visual indicator when past snap threshold
  const dragDxFraction = dragState ? dragState.currentDx / dragState.rectWidth : 0;
  const snapLines = Math.abs(dragDxFraction) > 0.33 ? Math.round(dragDxFraction) : 0;

  return (
    <div
      ref={measureRef}
      className="w-full mx-auto relative overflow-hidden"
      style={{ display: visible ? undefined : 'none' }}
    >
      {/* The canvas paints HEIGHT logical pixels; on very short viewports
          (phones in landscape) it is shown slightly flattened rather than cut
          off, so the lowest and highest rows always stay visible. */}
      <canvas
        key={canvasKey}
        ref={canvasRef}
        style={{
          display: 'block', width: '100%', height: `min(${HEIGHT}px, 45dvh)`,
          ...(canDragGap ? { cursor: dragState ? 'grabbing' : 'grab', touchAction: 'none' } : {}),
        }}
        onClick={onClick ? handleClick : undefined}
        onPointerDown={canDragGap ? handleGapPointerDown : undefined}
        onPointerMove={dragState ? handleGapPointerMove : undefined}
        onPointerUp={dragState ? handleGapPointerUp : undefined}
        onPointerCancel={dragState ? handleGapPointerUp : undefined}
      />

      {/* Drag-mode idle indicator — arrows + hint visible before dragging starts */}
      {canDragGap && !dragState && (
        <>
          <div className="absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none text-neon-purple/60 animate-pulse">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </div>
          <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-neon-purple/60 animate-pulse">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </div>
          <div className="absolute bottom-1 left-1/2 -translate-x-1/2 pointer-events-none px-2 py-0.5 rounded bg-black/50 text-neon-purple/70 text-xs">
            ← {t('gap.dragToFix')} →
          </div>
        </>
      )}

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
          {t('gap.dragToFix')}: {Math.floor(currentGap())} {t('gap.ms')}
        </div>
      )}
    </div>
  );
};

export default MusicBars;
