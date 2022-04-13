export const calcByTicks = (tickData, hitNotesByPlayer) => {
  let len = hitNotesByPlayer.ticks.length;

  for (let i = len; i < tickData.tick; i++) {
    let note = 0;
    if (tickData.lyricData.lyricRefs[i] && !tickData.lyricData.lyricRefs[i].isSilent) {
      note = hitNotesByPlayer.micInputs[hitNotesByPlayer.micInputs.length - 1].note;
    } else {
      note = 0;
    }

    hitNotesByPlayer.ticks[i] = { tick: i, note };
  }
};

export const calcScore = (tickData, hitNotesByPlayer) => {
  hitNotesByPlayer.score = 0;
  for (let i = 0; i < hitNotesByPlayer.ticks.length; i++) {
    let ref = tickData.lyricData.lyricRefs[i];
    if (ref !== undefined && hitNotesByPlayer.ticks[i].note === tickData.lyricData.lyricLines[ref.lineIndex][ref.syllableIndex].tone) {
      hitNotesByPlayer.score++;
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

    for (let j = -10; j < 10; j++) {
      if (Math.abs(expectedNote - (note + j * 12)) <= 6) {
        mostProbableNote = note + j * 12;
      }
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
