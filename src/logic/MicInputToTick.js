export const getAndSetHitNotesByPlayerTicks = (tickData, hitNotesByPlayerTicks, note, player) => {
  if (!hitNotesByPlayerTicks) hitNotesByPlayerTicks = {};
  if (!hitNotesByPlayerTicks[player]) hitNotesByPlayerTicks[player] = [];

  hitNotesByPlayerTicks[player] = hitNotesByPlayerTicks[player].filter(e => e.tickFloat < tickData.tickFloat);

  let mostProbableNote = 0;
  if (note !== 0) {
    let expectedNote = tickData.currentLine[tickData.lyricRef.syllableIndex].tone;

    for (let j = -10; j < 10; j++) {
      if (Math.abs(expectedNote - (note + j * 12)) <= 6) {
        mostProbableNote = note + j * 12;
      }
    }
  }

  hitNotesByPlayerTicks[player].push({
    tickFloat: tickData.tickFloat,
    note: mostProbableNote,
  });

  return hitNotesByPlayerTicks;
};
