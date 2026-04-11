export const calcByTicks = (tickData, hitNotesByPlayer) => {
  let len = hitNotesByPlayer.ticks.length;

  for (let i = len; i < tickData.tick; i++) {
    let note = 0;
    // Record the detected pitch for ALL ticks (not just non-silent ones).
    // The isSilent flag affects scoring only, not visualization —
    // the user should see their pitch indicator even during gaps between syllables.
    if (tickData.lyricData.lyricRefs[i]) {
      const inputs = hitNotesByPlayer.micInputs;
      if (inputs.length > 0) {
        note = inputs[inputs.length - 1].note;
      }
    }

    hitNotesByPlayer.ticks[i] = { tick: i, note };
  }
};

export const calcScore = (tickData, hitNotesByPlayer) => {
  hitNotesByPlayer.score = 0;
  for (let i = 0; i < hitNotesByPlayer.ticks.length; i++) {
    let ref = tickData.lyricData.lyricRefs[i];
    if (ref !== undefined && !ref.isSilent) {
      const syllable = tickData.lyricData.lyricLines[ref.lineIndex]?.[ref.syllableIndex];
      if (!syllable || syllable.isBreak) continue;
      const expected = syllable.tone;
      const sung = hitNotesByPlayer.ticks[i].note;
      // Allow ±1 semitone tolerance (matches server scoring)
      if (sung !== 0 && Math.abs(expected - sung) <= 1) {
        // Special/golden notes (marked with * in UltraStar) award double points
        hitNotesByPlayer.score += syllable.isSpecial ? 2 : 1;
      }
    }
  }
}

export const getAndSetHitNotesByPlayer = (tickData, hitNotesByPlayer, note, player) => {
  if (!hitNotesByPlayer) hitNotesByPlayer = {};
  if (!hitNotesByPlayer[player]) hitNotesByPlayer[player] = { micInputs: [], ticks: [], score: 0 };

  hitNotesByPlayer[player].micInputs = hitNotesByPlayer[player].micInputs.filter(e => e.tickFloat < tickData.tickFloat);
  hitNotesByPlayer[player].ticks = hitNotesByPlayer[player].ticks.filter(e => e.tick < tickData.tickFloat);

  let mostProbableNote = 0;
  if (note !== 0) {
    let expectedNote = tickData.currentLine[tickData.lyricRef?.syllableIndex]?.tone;

    if (expectedNote !== undefined) {
      // Snap to the octave of `note` that is closest to expectedNote.
      // No threshold — just pure closest-octave. The ±1 tolerance in
      // calcScore handles whether it actually counts as a hit.
      const diff = expectedNote - note;
      const octaveShift = Math.round(diff / 12) * 12;
      mostProbableNote = note + octaveShift;
    } else {
      // No expected note available (e.g. between syllables or line transition).
      // Use the raw detected note so it still shows up in visualization.
      mostProbableNote = note;
    }
  }

  hitNotesByPlayer[player].micInputs.push({
    tickFloat: tickData.tickFloat,
    note: mostProbableNote,
  });

  calcByTicks(tickData, hitNotesByPlayer[player]);
  calcScore(tickData, hitNotesByPlayer[player]);

  return hitNotesByPlayer;
};
