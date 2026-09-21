import React, { useRef, useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { hzToSemitone } from "../logic/MicSharedFuns";
import { playerHue } from "../logic/playerColor";
import { foldNotes } from "../logic/octaveFold";
import { buildSegments } from "../logic/noteSegments";
import useMeasure from "react-use-measure";

/**
 * The pitch "note highway": expected notes of the current lyric line, the
 * playback cursor and every player's sung pitch as glowing lines.
 *
 * Drawn on a <canvas>, driven straight from the live store (see liveStore.js):
 * a frame is one imperative paint of a few hundred primitives and touches no
 * DOM, which is what keeps it cheap on old phones. React only renders the
 * container, the drag overlays and the show/hide state.
 */

// Fixed vertical range in semitones. Every line uses the same span so that
// being off by N semitones always looks the same visually, regardless of how
// narrow/wide the expected notes in the current line are.
const VISIBLE_SEMITONES = 24;
const HEIGHT = 200;
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

/**
 * Grace period: detected pitches are shown within 1s of any expected note and
 * suppressed during truly quiet sections. Merged into sorted intervals so the
 * per-note check is a short scan instead of a pass over every syllable.
 */
function graceIntervals(expectedNotes, graceTicks) {
  const intervals = expectedNotes
    .map(el => [el.start - graceTicks, el.start + el.length + graceTicks])
    .sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const [s, e] of intervals) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  return merged;
}

const inIntervals = (intervals, t) => {
  for (let i = 0; i < intervals.length; i++) {
    if (t < intervals[i][0]) return false;
    if (t <= intervals[i][1]) return true;
  }
  return false;
};

function buildLineGeometry({ p1Line, p2Line, p1Singing, p2Singing, minTickLength, width, bpm }) {
  // --- Vertical range: fixed span, centered on both tracks' midpoint ---
  const p1Tones = p1Singing ? p1Line.filter(e => !e.isBreak).map(e => e.tone) : [];
  const p2Tones = p2Singing ? p2Line.filter(e => !e.isBreak).map(e => e.tone) : [];
  const allTones = [...p1Tones, ...p2Tones];
  const minTone = Math.min(...allTones);
  const maxTone = Math.max(...allTones);
  const midTone = (minTone + maxTone) / 2;
  const lowerBound = midTone - VISIBLE_SEMITONES / 2;
  const upperBound = midTone + VISIBLE_SEMITONES / 2;

  // --- Horizontal range: union of P1 and P2 line boundaries ---
  let lineStartTick, lastLineTick;
  if (p1Singing) {
    lineStartTick = p1Line[1].start;
    const lastEl = p1Line[p1Line.length - 1];
    lastLineTick = lastEl.start + lastEl.length;
  }
  if (p2Singing) {
    const p2Start = p2Line[1].start;
    const p2LastEl = p2Line[p2Line.length - 1];
    const p2End = p2LastEl.start + p2LastEl.length;
    if (p1Singing) {
      lineStartTick = Math.min(lineStartTick, p2Start);
      lastLineTick = Math.max(lastLineTick, p2End);
    } else {
      lineStartTick = p2Start;
      lastLineTick = p2End;
    }
  }
  const naturalLength = lastLineTick - lineStartTick;

  // If the line is shorter than the minimum, extend the visible range symmetrically
  const minLength = minTickLength ?? naturalLength;
  if (naturalLength < minLength) {
    const pad = (minLength - naturalLength) / 2;
    lineStartTick -= pad;
    lastLineTick += pad;
  }
  const lineLengthInTicks = lastLineTick - lineStartTick;

  const expectedNotes = p1Singing ? p1Line.filter(el => !el.isBreak) : [];
  const p2ExpectedNotes = p2Singing ? p2Line.filter(el => !el.isBreak) : [];

  return {
    width,
    midTone, lowerBound, upperBound,
    lineStartTick, lastLineTick, lineLengthInTicks,
    expectedNotes, p2ExpectedNotes,
    grace: graceIntervals(expectedNotes, (bpm / 60) * 1.0), // 1 second in ticks
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

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// A rap note is spoken, not pitched: its bar sits at the chart's nominal
// tone and is drawn hollow with a dashed edge, so it reads as "say it"
// rather than "hit this note".
function noteRect(ctx, geom, el, fill, stroke, alpha = 1) {
  const x = geom.tickToX(el.start);
  const y = geom.toneToY(el.tone) - NOTE_HEIGHT / 2;
  const w = geom.noteWidth(el);
  ctx.globalAlpha = el.isRap ? alpha * 0.7 : alpha;
  roundRect(ctx, x, y, w, NOTE_HEIGHT, NOTE_HEIGHT / 2);
  if (!el.isRap) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  ctx.lineWidth = 1;
  ctx.strokeStyle = el.isRap ? fill : stroke;
  if (el.isRap) ctx.setLineDash([3, 2]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
}

function specialOutline(ctx, geom, el, alpha, withHalo) {
  const x = geom.tickToX(el.start) - 1;
  const y = geom.toneToY(el.tone) - NOTE_HEIGHT / 2 - 1;
  const w = geom.noteWidth(el) + 2;
  const h = NOTE_HEIGHT + 2;
  ctx.globalAlpha = alpha;
  if (withHalo) {
    // Wide translucent stroke stands in for the blur filter the SVG had
    roundRect(ctx, x, y, w, h, NOTE_HEIGHT / 2 + 1);
    ctx.lineWidth = 5;
    ctx.strokeStyle = "rgba(255,215,0,0.35)";
    ctx.stroke();
  }
  roundRect(ctx, x, y, w, h, NOTE_HEIGHT / 2 + 1);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "#FFD700";
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function star(ctx, geom, el, color) {
  ctx.fillStyle = color;
  ctx.font = "6px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("★", geom.tickToX(el.start) + geom.noteWidth(el) / 2, geom.toneToY(el.tone) + 1);
}

/** Smooth path through segment points (same cubic as the old SVG version). */
function tracePath(ctx, points, tickWidth) {
  ctx.beginPath();
  for (let i = 0; i < points.length; i++) {
    const pt = points[i];
    const x = pt.x + tickWidth / 2;
    if (i === 0) {
      ctx.moveTo(x, pt.y);
    } else {
      const prev = points[i - 1];
      const prevX = prev.x + tickWidth / 2;
      const cpX = (prevX + x) / 2;
      ctx.bezierCurveTo(cpX, prev.y, cpX, pt.y, x, pt.y);
    }
  }
}

// ---------------------------------------------------------------------------

const MusicBars = ({ store, isHost, playerColors, scores, gapDragEnabled, setGap, onClick }) => {
  const scoresRef = useRef(scores);
  scoresRef.current = scores || {};
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
  const particlesRef = useRef([]);
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

  /** One frame. Called on every live-store update and on resize. */
  const draw = useCallback(() => {
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
    if (!nowVisible || !canvas || width <= 0) return;

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
        geom: buildLineGeometry({ p1Line, p2Line, p1Singing, p2Singing, minTickLength: medianRef.current.value, width, bpm }),
      };
    }
    const geom = geomRef.current.geom;
    const { midTone, lowerBound, lineStartTick, lastLineTick, lineLengthInTicks, expectedNotes, p2ExpectedNotes, grace, toneToY, tickToX, tickWidth } = geom;

    // --- Canvas setup (resize only when needed; resizing clears) ---
    const dpr = window.devicePixelRatio || 1;
    const pw = Math.round(width * dpr);
    const ph = Math.round(HEIGHT * dpr);
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, HEIGHT);

    // --- Cursor ---
    const cursorX = ((tickFloat - lineStartTick) / lineLengthInTicks) * width;
    const cursorTick = Math.floor(tickFloat);
    const lyricData = tickData.lyricData;
    const currentRef = p1Singing ? lyricData?.lyricRefs?.[cursorTick] : null;
    const currentSyllable = currentRef && !currentRef.isSilent
      ? lyricData?.lyricLines?.[currentRef.lineIndex]?.[currentRef.syllableIndex]
      : null;
    const isOnSpecialNote = currentSyllable?.isSpecial ?? false;
    const p1CurrentIdx = p1Singing && tickData.lyricRef && !tickData.lyricRef.isSilent ? tickData.lyricRef.syllableIndex : -1;
    const p2CurrentIdx = p2Singing && p2TickData.lyricRef && !p2TickData.lyricRef.isSilent ? p2TickData.lyricRef.syllableIndex : -1;

    // --- Semitone grid ---
    for (let i = 0; i <= VISIBLE_SEMITONES; i++) {
      const tone = lowerBound + i;
      const isOctave = Math.round(tone) % 12 === 0;
      const y = toneToY(tone);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.lineWidth = isOctave ? 1 : 0.5;
      ctx.strokeStyle = isOctave ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.04)";
      ctx.stroke();
    }

    // --- Expected notes: dim "upcoming" layer, full width ---
    for (const el of p2ExpectedNotes) noteRect(ctx, geom, el, COLOR_P2, "rgba(255,140,66,0.15)", 0.25);
    for (const el of expectedNotes) {
      if (el.isSpecial) specialOutline(ctx, geom, el, 0.3 * 0.4, false);
      noteRect(ctx, geom, el, el.isSpecial ? COLOR_SPECIAL : COLOR_P1, el.isSpecial ? "rgba(255,215,0,0.2)" : "rgba(255,255,255,0.15)", 0.3);
      if (el.isSpecial) star(ctx, geom, el, "rgba(255,255,255,0.4)");
    }

    // --- Everything left of the cursor: bright expected notes + player lines ---
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, Math.max(0, cursorX), HEIGHT);
    ctx.clip();

    p2ExpectedNotes.forEach((el, i) => noteRect(ctx, geom, el, i + 1 === p2CurrentIdx ? COLOR_P2_CURRENT : COLOR_P2, "rgba(255,140,66,0.3)"));
    expectedNotes.forEach((el, i) => {
      const isCurrent = i + 1 === p1CurrentIdx;
      if (el.isSpecial) specialOutline(ctx, geom, el, isCurrent ? 1 : 0.5, true);
      noteRect(ctx, geom, el,
        el.isSpecial ? (isCurrent ? COLOR_SPECIAL_CURRENT : COLOR_SPECIAL) : (isCurrent ? COLOR_P1_CURRENT : COLOR_P1),
        el.isSpecial ? "rgba(255,215,0,0.4)" : "rgba(255,255,255,0.3)");
      if (el.isSpecial) star(ctx, geom, el, "rgba(255,255,255,0.7)");
    });

    // --- Players' notes inside the visible window ---
    // Notes are stored as { videoTime, freq } in arrival order. Walk each
    // player's list from the newest note backwards and stop as soon as we are
    // before the line, so the cost is the notes on screen, not everything kept.
    const ticksPerSec = lyricData.bpm / 60;
    const gapSec = lyricData.gap / 1000;
    const notesByTick = {}; // rounded tick → [{ username, semitone }] for overlap detection
    const perPlayer = [];
    // The chart tone a note is aiming at: the syllable at its tick, or — in the
    // grace period around notes — the nearest syllable within a second
    const lyricRefs = lyricData?.lyricRefs;
    const toneAtTick = (tick) => {
      const ref = lyricRefs?.[tick];
      const syl = ref && !ref.isSilent ? lyricData?.lyricLines?.[ref.lineIndex]?.[ref.syllableIndex] : null;
      return syl?.tone;
    };
    const graceTicks = Math.ceil(ticksPerSec);
    const targetToneNear = (tf) => {
      const tick = Math.floor(Math.max(0, tf));
      const here = toneAtTick(tick);
      if (here !== undefined) return here;
      for (let d = 1; d <= graceTicks; d++) {
        const ahead = toneAtTick(tick + d);
        if (ahead !== undefined) return ahead;
        const behind = toneAtTick(tick - d);
        if (behind !== undefined) return behind;
      }
      return undefined;
    };
    for (const username in notesByPlayer) {
      const arr = notesByPlayer[username].notes;
      const visibleNotes = [];
      for (let i = arr.length - 1; i >= 0; i--) {
        const n = arr[i];
        const tf = ticksPerSec * (n.videoTime - gapSec);
        if (tf > lastLineTick) continue;
        if (tf < lineStartTick) break;
        if (n.freq <= 0 || !inIntervals(grace, tf)) continue;
        const raw = n.st ?? (n.st = hzToSemitone(n.freq)); // cached on the note
        visibleNotes.push({ tf, videoTime: n.videoTime, raw, rawSemitone: raw, target: targetToneNear(tf) });
      }
      if (!visibleNotes.length) continue;
      visibleNotes.reverse(); // chronological

      // Octave folding (charts are octave-agnostic): each note toward its own
      // target, hysteresis only for ambiguous notes — see octaveFold.js.
      const shifts = foldNotes(visibleNotes, { midTone });
      visibleNotes.forEach((v, i) => {
        v.semitone = v.raw + shifts[i];
        (notesByTick[Math.round(v.tf)] ||= []).push({ username, semitone: v.semitone });
      });
      perPlayer.push({ username, visibleNotes });
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
    for (const { username, visibleNotes } of perPlayer) {
      // Place each note and classify it against the chart, then group into
      // continuous line segments (gold only where a golden note is overlapped)
      const points = visibleNotes.map(({ tf, rawSemitone, semitone }) => {
        const baseY = Math.max(0, Math.min(HEIGHT - NOTE_HEIGHT, toneToY(semitone) - NOTE_HEIGHT / 2)) + NOTE_HEIGHT / 2;
        const { offset, count } = overlapInfo(Math.round(tf), semitone, username);
        const y = Math.max(NOTE_HEIGHT / 2, Math.min(HEIGHT - NOTE_HEIGHT / 2, baseY + offset));

        // Hit = within ±1 semitone of the expected tone at this tick
        const tick = Math.floor(Math.max(0, tf));
        const ref = lyricData?.lyricRefs?.[tick];
        const syllable = ref && !ref.isSilent ? lyricData?.lyricLines?.[ref.lineIndex]?.[ref.syllableIndex] : null;
        const expectedTone = syllable?.tone;
        const isHit = expectedTone !== undefined && (syllable.isRap || Math.abs(semitone - expectedTone) <= 1);
        return { tf, x: tickToX(tf), y, rawSemitone, isHit, isSpecial: syllable?.isSpecial ?? false, count };
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
          const cx = pt.x + tickWidth / 2;
          ctx.beginPath();
          ctx.arc(cx, pt.y, NOTE_HEIGHT * 0.7 * scale, 0, Math.PI * 2);
          ctx.fillStyle = s.isSpecial ? "rgba(255,215,0,0.3)" : haloColor;
          ctx.fill();
          ctx.beginPath();
          ctx.arc(cx, pt.y, NOTE_HEIGHT * 0.4 * scale, 0, Math.PI * 2);
          ctx.fillStyle = s.isSpecial ? "#FFD700" : color;
          ctx.fill();
          continue;
        }
        // Three strokes (wide halo, main line, bright core) give the glow
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        tracePath(ctx, s.points, tickWidth);
        ctx.lineWidth = NOTE_HEIGHT * 1.2 * scale;
        ctx.strokeStyle = s.isSpecial ? "rgba(255,215,0,0.4)" : haloColor;
        ctx.stroke();
        ctx.lineWidth = NOTE_HEIGHT * 0.6 * scale;
        ctx.strokeStyle = s.isSpecial ? "#FFD700" : color;
        ctx.stroke();
        ctx.lineWidth = NOTE_HEIGHT * 0.2 * scale;
        ctx.strokeStyle = s.isSpecial ? "#FFFACD" : coreColor;
        ctx.stroke();
      }

      // Feedback text for the latest active segment
      const active = segments.find(s => s.endTick >= cursorTick - 2 && s.startTick <= cursorTick);
      if (active && active.hitCount >= GREAT_THRESHOLD) {
        const lastPt = active.points[active.points.length - 1];
        feedback.push({ hue, text: active.hitCount >= AWESOME_THRESHOLD ? "AWESOME!" : "GREAT!", x: lastPt.x, y: lastPt.y - 20 });
      }
    }
    ctx.restore(); // end cursor clip

    // --- Cursor ---
    if (isOnSpecialNote) {
      ctx.fillStyle = "rgba(255,215,0,0.15)";
      roundRect(ctx, cursorX - 4, 0, 11, HEIGHT, 5);
      ctx.fill();
    }
    ctx.fillStyle = isOnSpecialNote ? "rgba(255,215,0,0.8)" : "rgba(255,255,255,0.6)";
    ctx.fillRect(cursorX, 0, 3, HEIGHT);

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
      p.x += p.vx; p.y += p.vy; p.life -= p.decay;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${p.hue}, 100%, 75%, ${p.life * 0.8})`;
      ctx.fill();
    }

    // --- Feedback text ("GREAT!", "AWESOME!") ---
    for (const fb of feedback) {
      const isAwesome = fb.text === "AWESOME!";
      ctx.font = `bold ${isAwesome ? 16 : 13}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      if (isAwesome) {
        // pulse like the old animate-pulse class
        ctx.globalAlpha = 0.75 + 0.25 * Math.sin(now / 160);
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(255,215,0,0.3)";
        ctx.strokeText(fb.text, fb.x, fb.y);
        ctx.fillStyle = "#FFD700";
      } else {
        ctx.fillStyle = `hsl(${fb.hue}, 100%, 80%)`;
      }
      ctx.fillText(fb.text, fb.x, fb.y);
      ctx.globalAlpha = 1;
    }

    // --- Score tags: each singer's name + score rides along their pitch line
    // at the cursor; whoever is not singing right now is listed, dimmed, at
    // the bottom left. This is the scoreboard.
    const scores = scoresRef.current;
    const liveScores = store.scores ?? {}; // rode along with the notes, newer than the JSON board
    const lanes = store.lanes ?? null; // past the lane count: who the server put on screen
    ctx.font = "bold 12px sans-serif";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    const recentTicks = 1.5 * ticksPerSec;
    const placed = []; // tag centres already used, so neighbours stack instead of overlapping
    const TAG_H = 18;
    const drawTag = (username, x, y, align, alpha) => {
      const score = liveScores[username] ?? scores[username]?.score;
      const label = lanes?.pinned.includes(username) ? `★ ${username}` : username;
      const text = score !== undefined ? `${label}  ${score.toLocaleString()}` : label;
      const hue = playerHue(colorsRef.current, username);
      const w = ctx.measureText(text).width + 14;
      let ty = Math.max(TAG_H / 2, Math.min(HEIGHT - TAG_H / 2, y));
      for (const p of placed) if (Math.abs(p - ty) < TAG_H) ty = p + TAG_H;
      ty = Math.min(HEIGHT - TAG_H / 2, ty);
      placed.push(ty);
      // right of the cursor line when there is no room to its left
      const tx = align === "right" ? (x - w >= 4 ? x - w : x + 16) : x;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = "rgba(10,10,26,0.75)";
      roundRect(ctx, tx, ty - TAG_H / 2, w, TAG_H, 9);
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = `hsla(${hue}, 100%, 60%, 0.8)`;
      ctx.stroke();
      ctx.fillStyle = `hsl(${hue}, 100%, 82%)`;
      ctx.fillText(text, tx + 7, ty + 0.5);
      ctx.globalAlpha = 1;
    };
    const tagged = new Set();
    for (const { username, visibleNotes } of perPlayer) {
      const last = visibleNotes[visibleNotes.length - 1];
      if (!last || cursorTick - last.tf > recentTicks) continue;
      drawTag(username, cursorX - 8, toneToY(last.semitone), "right", 0.95);
      tagged.add(username);
    }
    // In a crowd the quiet list is the lanes, not everyone who ever sang
    const listed = lanes ? [...lanes.pinned, ...lanes.spotlight] : new Set([...Object.keys(scores), ...Object.keys(liveScores)]);
    let idle = 0;
    for (const username of listed) {
      if (tagged.has(username)) continue;
      drawTag(username, Math.max(56, width * 0.06), HEIGHT - 12 - idle * (TAG_H + 2), "left", 0.7);
      idle++;
    }
    // Your own place in that crowd
    const standing = store.standing;
    if (lanes && standing) {
      ctx.font = "bold 13px sans-serif";
      ctx.textAlign = "right";
      ctx.textBaseline = "top";
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.fillText(`#${standing.rank} / ${standing.total}`, width - 10, 8);
    }
  }, [store]);

  // Redraw on every live-store update, and whenever the container is resized
  useEffect(() => store.subscribe(draw), [store, draw]);
  useEffect(() => { draw(); }, [draw, bounds.width, visible]);

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
