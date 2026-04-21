/**
 * Frequency-based note storage and scoring.
 *
 * Notes are stored as raw Hz frequencies with videoTime (seconds).
 * Conversion to UltraStar semitone space happens only when needed:
 *   - Scoring: Hz → semitone for comparison against expected tone
 *   - Display: Hz → continuous semitone for Y-positioning in MusicBars
 *
 * Data structure per player:
 *   { notes: [{ videoTime, freq }], score: number }
 *
 * Scoring is time-proportional: each note sample has an implicit
 * duration (until the next sample). Score accumulates as
 *   dt * (bpm/60) * multiplier
 * when the note matches the expected tone within ±1 semitone.
 */

import { hzToSemitone } from './MicSharedFuns';

/**
 * Process a local mic note and update the player's note history + score.
 * Called from PartyPage's processing callback on each pitch detection result.
 *
 * @param {object} tickData - Current tick state (from getTickData)
 * @param {object} hitNotesByPlayer - Map of username → { notes, score }
 * @param {number} freq - Raw detected frequency in Hz (0 = silence)
 * @param {string} player - Username
 * @param {number} videoTime - Current video time in seconds
 * @returns {object} Updated hitNotesByPlayer (same reference, mutated)
 */
export const getAndSetHitNotesByPlayer = (tickData, hitNotesByPlayer, freq, player, videoTime) => {
  if (!hitNotesByPlayer) hitNotesByPlayer = {};
  if (!hitNotesByPlayer[player]) hitNotesByPlayer[player] = { notes: [], score: 0 };

  const pData = hitNotesByPlayer[player];

  // Prune old notes (keep ~30s window to cover any display needs)
  const pruneTime = videoTime - 30;
  while (pData.notes.length > 0 && pData.notes[0].videoTime < pruneTime) {
    pData.notes.shift();
  }

  // Store raw frequency — no conversion or octave adjustment.
  // MusicBars and calcScore do Hz → semitone conversion when needed.
  pData.notes.push({ videoTime, freq });

  // Recompute time-proportional score
  calcScore(tickData.lyricData, pData);

  return hitNotesByPlayer;
};

/**
 * Time-proportional scoring.
 * Each consecutive pair of notes defines a duration. If the note matches
 * the expected tone (±1 semitone after octave adjustment), score is
 * accumulated proportional to the time held: dt * (bpm/60) * multiplier.
 */
export const calcScore = (lyricData, playerData) => {
  const { notes } = playerData;
  if (notes.length < 2) { playerData.score = 0; return; }

  const { bpm, gap, lyricRefs, lyricLines } = lyricData;
  const tickRate = bpm / 60; // ticks per second

  let score = 0;

  for (let i = 0; i < notes.length - 1; i++) {
    const { videoTime, freq } = notes[i];
    if (freq <= 0) continue;

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
    // Hz → continuous semitone, then octave-adjust to nearest octave of expected
    const semitone = hzToSemitone(freq);
    const octaveAdj = Math.round((expected - semitone) / 12) * 12;
    if (Math.abs(semitone + octaveAdj - expected) <= 1) {
      // dt * tickRate = "ticks worth of time" — score parity with old system
      score += dt * tickRate * (syllable.isSpecial ? 2 : 1);
    }
  }

  playerData.score = Math.round(score);
};

/**
 * Apply a batch of remote notes received from the server.
 * Notes arrive as { username, freq, videoTime } — store directly.
 * MusicBars converts Hz → continuous semitone at render time.
 */
export const applyRemoteNotes = (hitNotesByPlayer, notes) => {
  if (!hitNotesByPlayer) hitNotesByPlayer = {};
  for (const { username, freq, videoTime } of notes) {
    if (!hitNotesByPlayer[username]) hitNotesByPlayer[username] = { notes: [], score: 0 };
    hitNotesByPlayer[username].notes.push({ videoTime, freq });
  }
  return hitNotesByPlayer;
};
