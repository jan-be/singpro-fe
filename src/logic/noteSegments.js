/**
 * Groups one player's sung notes into the continuous line segments the note
 * highway draws.
 *
 * A segment continues while the raw pitch stays within a semitone and there is
 * no gap of more than two ticks — a held note stays one line even across
 * syllables with different octave shifts. Golden (special) notes are drawn in
 * gold, so a segment also ends where the sung note enters or leaves a golden
 * note: only the overlapping part is gold, not the whole sung note. The new
 * segment starts at the previous point so the line stays unbroken.
 *
 * @param {Array<{ tf: number, x: number, y: number, rawSemitone: number, isHit: boolean, isSpecial: boolean, count: number }>} points
 *        chronological; `count` = how many players overlap at this point
 * @returns {Array<{ rawSemitone, startTick, endTick, points: {x,y}[], hitCount, isSpecial, maxOverlap }>}
 */
export function buildSegments(points) {
  const segments = [];
  let seg = null;
  for (const { tf, x, y, rawSemitone, isHit, isSpecial, count } of points) {
    const continuous = seg !== null && Math.abs(rawSemitone - seg.rawSemitone) <= 1 && tf - seg.endTick <= 2;
    if (continuous && seg.isSpecial === isSpecial) {
      seg.endTick = tf;
      seg.points.push({ x, y });
      if (isHit) seg.hitCount++;
      seg.maxOverlap = Math.max(seg.maxOverlap, count);
    } else {
      const joint = continuous ? [seg.points[seg.points.length - 1]] : [];
      if (seg) segments.push(seg);
      seg = { rawSemitone, startTick: tf, endTick: tf, points: [...joint, { x, y }], hitCount: isHit ? 1 : 0, isSpecial, maxOverlap: count };
    }
  }
  if (seg) segments.push(seg);
  return segments;
}
