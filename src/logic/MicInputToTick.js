export const calcCombos = (tickData, hitNotesByPlayer) => {
  if (hitNotesByPlayer.ticks.length <= 1 || (hitNotesByPlayer.combos[0] && tickData.tickFloat === hitNotesByPlayer.combos[hitNotesByPlayer.combos.length - 1].end)) {
    return;
  }

  let lastCombo = hitNotesByPlayer.combos[hitNotesByPlayer.combos.length - 1];

  if (!lastCombo || !(lastCombo.note === hitNotesByPlayer.ticks[hitNotesByPlayer.ticks.length - 1].note)) {
    hitNotesByPlayer.combos.push({
      start: hitNotesByPlayer.ticks[hitNotesByPlayer.ticks.length - 2].tickFloat,
      end: hitNotesByPlayer.ticks[hitNotesByPlayer.ticks.length - 1].tickFloat,
      note: hitNotesByPlayer.ticks[hitNotesByPlayer.ticks.length - 1].note,
    });
  } else {
    lastCombo.end = tickData.tickFloat;
  }
};

export const calcTrueCombos = (tickData, hitNotesByPlayer) => {
  let lastCombo = hitNotesByPlayer.combos[hitNotesByPlayer.combos.length - 1];

  console.log("before", tickData, hitNotesByPlayer.combos[hitNotesByPlayer.combos.length - 2], lastCombo, tickData.currentLine[tickData.lyricRef.syllableIndex]);

  if (lastCombo && lastCombo.note !== 0 && tickData.lyricRef.isSilent) {
    if (hitNotesByPlayer.combos[hitNotesByPlayer.combos.length - 2].start === tickData.currentLine[tickData.lyricRef.syllableIndex - 1].start + tickData.currentLine[tickData.lyricRef.syllableIndex - 1].length) {
      console.log("pop");
      hitNotesByPlayer.combos.pop();
    } else {
      let endTime = tickData.currentLine[tickData.lyricRef.syllableIndex - 1].start + tickData.currentLine[tickData.lyricRef.syllableIndex - 1].length;

      lastCombo.end = endTime;
      hitNotesByPlayer.combos.push({ start: endTime, end: tickData.tickFloat, note: 0 });
    }
  }
  console.log("after", tickData, hitNotesByPlayer.combos[hitNotesByPlayer.combos.length - 2], lastCombo, tickData.currentLine[tickData.lyricRef.syllableIndex]);

  // console.log(hitNotesByPlayer, tickData);
};

export const getAndSetHitNotesByPlayer = (tickData, hitNotesByPlayer, note, player) => {
  if (!hitNotesByPlayer) hitNotesByPlayer = {};
  if (!hitNotesByPlayer[player]) hitNotesByPlayer[player] = { ticks: [], combos: [] };

  hitNotesByPlayer[player].ticks = hitNotesByPlayer[player].ticks.filter(e => e.tickFloat < tickData.tickFloat);

  let mostProbableNote = 0;
  if (note !== 0) {
    let expectedNote = tickData.currentLine[tickData.lyricRef.syllableIndex].tone;

    for (let j = -10; j < 10; j++) {
      if (Math.abs(expectedNote - (note + j * 12)) <= 6) {
        mostProbableNote = note + j * 12;
      }
    }
  }

  hitNotesByPlayer[player].ticks.push({
    tickFloat: tickData.tickFloat,
    note: mostProbableNote,
  });

  calcCombos(tickData, hitNotesByPlayer[player]);

  // calcTrueCombos(tickData, hitNotesByPlayer[player]);

  return hitNotesByPlayer;
};
