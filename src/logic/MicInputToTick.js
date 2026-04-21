/**
 * Time-based note storage and scoring.
 *
 * Notes are stored with videoTime (seconds). Conversion to ticks
 * happens only at render time (MusicBars) and for ground-truth
 * comparison (scoring against lyricRefs).
 *
 * Data structure per player:
 *   { notes: [{ videoTime, note }], score: number }
 *
 * Scoring is time-proportional: each note sample has an implicit
 * duration (until the next sample). Score accumulates as
 *   dt * (bpm/60) * multiplier
 * when the note matches the expected tone within ±1 semitone.
 * This is mathematically equivalent to the old per-tick scoring for
 * full ticks, but also awards partial credit for partial ticks.
 */

import { secSinceStartToTickFloat } from './LyricsParser';

/**
 * Process a local mic note and update the player's note history + score.
 * Called from PartyPage's processing callback on each pitch detection result.
 *
 * @param {object} tickData - Current tick state (from getTickData)
 * @param {object} hitNotesByPlayer - Map of username → { notes, score }
 * @param {number} note - Raw detected MIDI note (0 = silence)
 * @param {string} player - Username
 * @param {number} videoTime - Current video time in seconds
 * @returns {object} Updated hitNotesByPlayer (same reference, mutated)
 */
export const getAndSetHitNotesByPlayer = (tickData, hitNotesByPlayer, note, player, videoTime) => {
  if (!hitNotesByPlayer) hitNotesByPlayer = {};
  if (!hitNotesByPlayer[player]) hitNotesByPlayer[player] = { notes: [], score: 0 };

  const pData = hitNotesByPlayer[player];

  // Prune old notes (keep ~30s window to cover any display needs)
  const pruneTime = videoTime - 30;
  while (pData.notes.length > 0 && pData.notes[0].videoTime < pruneTime) {
    pData.notes.shift();
  }

  // Octave-adjust the note relative to the expected tone
  let adjustedNote = 0;
  if (note !== 0) {
    const expectedNote = tickData.currentLine[tickData.lyricRef?.syllableIndex]?.tone;
    if (expectedNote !== undefined) {
      const diff = expectedNote - note;
      const octaveShift = Math.round(diff / 12) * 12;
      adjustedNote = note + octaveShift;
    } else {
      adjustedNote = note;
    }
  }

  pData.notes.push({ videoTime, note: adjustedNote });

  // Recompute time-proportional score
  calcScore(tickData.lyricData, pData);

  return hitNotesByPlayer;
};

/**
 * Time-proportional scoring.
 * Each consecutive pair of notes defines a duration. If the note matches
 * the expected tone (±1 semitone), score is accumulated proportional to
 * the time held: dt * (bpm/60) * multiplier.
 */
export const calcScore = (lyricData, playerData) => {
  const { notes } = playerData;
  if (notes.length < 2) { playerData.score = 0; return; }

  const { bpm, gap, lyricRefs, lyricLines } = lyricData;
  const tickRate = bpm / 60; // ticks per second

  let score = 0;

  for (let i = 0; i < notes.length - 1; i++) {
    const { videoTime, note } = notes[i];
    if (note === 0) continue;

    // Duration this note was held (until next sample), cap at 200ms
    const dt = Math.min(notes[i + 1].videoTime - videoTime, 0.2);
    if (dt <= 0) continue;

    // Convert to tick for ground-truth lookup
    const tickFloat = tickRate * (videoTime - gap / 1000);
    const tick = Math.floor(Math.max(0, tickFloat));
    const ref = lyricRefs?.[tick];
    if (!ref || ref.isSilent) continue;

    const syllable = lyricLines[ref.lineIndex]?.[ref.syllableIndex];
    if (!syllable || syllable.isBreak) continue;

    const expected = syllable.tone;
    if (Math.abs(note - expected) <= 1) {
      // dt * tickRate = "ticks worth of time" — score parity with old system
      score += dt * tickRate * (syllable.isSpecial ? 2 : 1);
    }
  }

  playerData.score = Math.round(score);
};

/**
 * Apply a batch of remote notes received from the server.
 * Notes arrive as { username, note, videoTime } — store directly.
 * MusicBars converts videoTime → tickFloat at render time.
 */
export const applyRemoteNotes = (hitNotesByPlayer, notes) => {
  if (!hitNotesByPlayer) hitNotesByPlayer = {};
  for (const { username, note, videoTime } of notes) {
    if (!hitNotesByPlayer[username]) hitNotesByPlayer[username] = { notes: [], score: 0 };
    hitNotesByPlayer[username].notes.push({ videoTime, note });
  }
  return hitNotesByPlayer;
};
