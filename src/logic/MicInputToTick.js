/**
 * Frequency-based note storage and scoring.
 *
 * Notes are stored as raw Hz frequencies with videoTime (seconds).
 * Conversion to UltraStar semitone space happens only when needed:
 *   - Scoring: Hz → semitone for comparison against expected tone
 *   - Display: Hz → continuous semitone for Y-positioning in MusicBars
 *
 * Data structure per player (PlayerNotes):
 *   { notes: [{ videoTime, freq }], score: number }
 *
 * Scoring is time-proportional: each note sample has an implicit
 * duration (until the next sample). Score accumulates as
 *   dt * (bpm/60) * multiplier
 * when the note matches the expected tone within ±1 semitone.
 */

import { hzToSemitone } from './MicSharedFuns';

/**
 * One singer's notes of the last 30 s, which MusicBars draws, and for the
 * local singer this browser's own score over them.
 *
 * The score is only read when a recording is uploaded, so it is worked out
 * when read, from the notes and the chart timing the newest local note was
 * judged against. Re-scoring the whole window on every note was ~1,000 notes
 * ~33 times a second. Same notes, same chart, same sum in the same order: the
 * number is the one scoring every note gave.
 */
class PlayerNotes {
  constructor() {
    this.notes = [];
    // What the newest local note was judged against (calcScore reads these
    // four; gap is copied, the host's timing fix moves it in place), and
    // whether the score over the notes as they are now is still to be worked out
    this.judgedBy = { bpm: 0, gap: 0, lyricRefs: null, lyricLines: null };
    this.unscored = false;
    this.scored = 0;
  }

  /** The notes now are the ones the newest local note was judged with. */
  judge({ bpm, gap, lyricRefs, lyricLines }) {
    const j = this.judgedBy;
    j.bpm = bpm; j.gap = gap; j.lyricRefs = lyricRefs; j.lyricLines = lyricLines;
    this.unscored = true;
  }

  get score() {
    if (this.unscored) {
      this.scored = scoreNotes(this.judgedBy, this.notes);
      this.unscored = false;
    }
    return this.scored;
  }
}

/**
 * Process a local mic note and update the player's note history + score.
 * Called from PartyPage's processing callback on each pitch detection result.
 *
 * @param {object} tickData - Current tick state (from getTickData)
 * @param {object} hitNotesByPlayer - Map of username → PlayerNotes { notes, score }
 * @param {number} freq - Raw detected frequency in Hz (0 = silence)
 * @param {string} player - Username
 * @param {number} videoTime - Current video time in seconds
 * @returns {object} Updated hitNotesByPlayer (same reference, mutated)
 */
export const getAndSetHitNotesByPlayer = (tickData, hitNotesByPlayer, freq, player, videoTime) => {
  if (!hitNotesByPlayer) hitNotesByPlayer = {};
  if (!hitNotesByPlayer[player]) hitNotesByPlayer[player] = new PlayerNotes();

  const pData = hitNotesByPlayer[player];

  // Prune old notes (keep ~30s window to cover any display needs)
  const pruneTime = videoTime - 30;
  while (pData.notes.length > 0 && pData.notes[0].videoTime < pruneTime) {
    pData.notes.shift();
  }

  // Store raw frequency — no conversion or octave adjustment.
  // MusicBars and calcScore do Hz → semitone conversion when needed.
  pData.notes.push({ videoTime, freq });

  // Time-proportional score over these notes, worked out when read
  pData.judge(tickData.lyricData);

  return hitNotesByPlayer;
};

/**
 * Time-proportional scoring.
 * Each consecutive pair of notes defines a duration. If the note matches
 * the expected tone (±1 semitone after octave adjustment), score is
 * accumulated proportional to the time held: dt * (bpm/60) * multiplier.
 */
export const calcScore = (lyricData, playerData) => {
  playerData.score = scoreNotes(lyricData, playerData.notes);
};

/** calcScore's sum: the score of `notes` against `lyricData` ({ bpm, gap, lyricRefs, lyricLines }). */
const scoreNotes = (lyricData, notes) => {
  if (notes.length < 2) return 0;

  const { bpm, gap, lyricRefs, lyricLines } = lyricData;
  const tickRate = bpm / 60; // ticks per second

  let score = 0;

  for (let i = 0; i < notes.length - 1; i++) {
    const { videoTime, freq } = notes[i];
    if (freq <= 0) continue;

    // Duration this note was held (until next sample), cap at 200ms
    const dt = Math.min(notes[i + 1].videoTime - videoTime, 0.2);
    if (dt <= 0) continue;

    // Convert to tick for ground-truth lookup. Deliberately not clamped to
    // 0 the way the display path is: before the gap there is no note to
    // sing, and nearly every chart starts its first note on tick 0, so
    // clamping scored the whole intro as that note. A negative tick finds
    // nothing in lyricRefs, which is what we want.
    const tickFloat = tickRate * (videoTime - gap / 1000);
    const tick = Math.floor(tickFloat);
    const ref = lyricRefs?.[tick];
    if (!ref || ref.isSilent) continue;

    const syllable = lyricLines[ref.lineIndex]?.[ref.syllableIndex];
    if (!syllable || syllable.isBreak) continue;

    const expected = syllable.tone;
    // Hz → continuous semitone, then octave-adjust to nearest octave of expected.
    // A rap note is spoken: any voiced sample (freq > 0, above) hits it.
    const semitone = hzToSemitone(freq);
    const octaveAdj = Math.round((expected - semitone) / 12) * 12;
    if (syllable.isRap || Math.abs(semitone + octaveAdj - expected) <= 1) {
      // dt * tickRate = "ticks worth of time" — score parity with old system
      score += dt * tickRate * (syllable.isSpecial ? 2 : 1);
    }
  }

  return Math.round(score);
};

/**
 * Apply a batch of remote notes received from the server.
 * Notes arrive as { username, freq, videoTime } — store directly.
 * MusicBars converts Hz → continuous semitone at render time.
 */
export const applyRemoteNotes = (hitNotesByPlayer, notes) => {
  if (!hitNotesByPlayer) hitNotesByPlayer = {};
  for (const { username, freq, videoTime } of notes) {
    if (!hitNotesByPlayer[username]) hitNotesByPlayer[username] = new PlayerNotes();
    const pData = hitNotesByPlayer[username];
    // A local score not worked out yet is over the notes as they are: settle
    // it before they change (only if this name was the local singer's before)
    if (pData.unscored) void pData.score;
    // Same 30s window as local notes — MusicBars walks every stored note per
    // frame, so an unbounded array made each frame slower for the whole song.
    const pruneTime = videoTime - 30;
    while (pData.notes.length > 0 && pData.notes[0].videoTime < pruneTime) {
      pData.notes.shift();
    }
    pData.notes.push({ videoTime, freq });
  }
  return hitNotesByPlayer;
};
