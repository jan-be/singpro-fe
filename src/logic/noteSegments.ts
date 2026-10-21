/** How far one sung point may be from the one before it and still continue the line. */
export const MAX_STEP_SEMITONES = 2;

/** One sung point of a player's line on the highway, as buildSegments reads it. */
export interface SungPoint {
  tf: number;
  x: number;
  y: number;
  rawSemitone: number;
  /** the pitch as drawn (octave-folded); rawSemitone when not given */
  semitone?: number;
  isHit: boolean;
  isSpecial: boolean;
  /** how many players overlap at this point */
  count: number;
}

/** A continuous stretch of one player's sung line (buildSegments). */
export interface NoteSegment {
  startTick: number;
  endTick: number;
  points: { x: number, y: number }[];
  hitCount: number;
  isSpecial: boolean;
  maxOverlap: number;
}

/**
 * Groups one player's sung notes into the continuous line segments the note
 * highway draws.
 *
 * A segment continues while each point stays within two semitones of the one
 * before it — in raw pitch and as drawn — with no gap of more than two ticks.
 * So a held note stays one line even across syllables with different octave
 * shifts, and a glide from one note to the next is drawn as a line, not as a
 * row of dots (at a note every 30 ms a glide moves more than a semitone per
 * note; comparing with where the segment started broke every glide apart).
 * A jump of more than two semitones, or an octave change in how it is drawn,
 * still starts a new segment. Golden (special) notes are drawn in gold, so a
 * segment also ends where the sung note enters or leaves a golden note: only
 * the overlapping part is gold, not the whole sung note. The new segment starts
 * at the previous point so the line stays unbroken.
 *
 * @param points
 *        chronological; `semitone` = the pitch as drawn (octave-folded), `count` = how many players overlap at this point
 */
export function buildSegments(points: readonly SungPoint[]): NoteSegment[] {
  const segments: NoteSegment[] = [];
  let seg: NoteSegment | null = null;
  let last: { raw: number, drawn: number } | null = null; // the previous point: its raw and drawn pitch
  for (const { tf, x, y, rawSemitone, semitone = rawSemitone, isHit, isSpecial, count } of points) {
    const continuous: boolean = seg !== null
      && tf - seg.endTick <= 2
      && Math.abs(rawSemitone - last!.raw) <= MAX_STEP_SEMITONES
      && Math.abs(semitone - last!.drawn) <= MAX_STEP_SEMITONES;
    if (continuous && seg!.isSpecial === isSpecial) {
      seg!.endTick = tf;
      seg!.points.push({ x, y });
      if (isHit) seg!.hitCount++;
      seg!.maxOverlap = Math.max(seg!.maxOverlap, count);
    } else {
      const joint: { x: number, y: number }[] = continuous ? [seg!.points[seg!.points.length - 1]] : [];
      if (seg) segments.push(seg);
      seg = { startTick: tf, endTick: tf, points: [...joint, { x, y }], hitCount: isHit ? 1 : 0, isSpecial, maxOverlap: count };
    }
    last = { raw: rawSemitone, drawn: semitone };
  }
  if (seg) segments.push(seg);
  return segments;
}
