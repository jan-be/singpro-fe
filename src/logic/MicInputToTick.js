const getAverage = (oldAverage, oldSampleCount, newValue) => {
  return (oldAverage * oldSampleCount + newValue) / (oldSampleCount + 1);
};

export const getAndSetHitNotesByPlayerTicks = (tickData, hitNotesByPlayerTicks, note, player) => {
  if (!hitNotesByPlayerTicks) hitNotesByPlayerTicks = {};
  if (!hitNotesByPlayerTicks[player]) hitNotesByPlayerTicks[player] = {};
  let hitNoteObj = hitNotesByPlayerTicks[player][tickData.tick] ?? { actualTone: 0, samples: 0 };

  let newAverage = getAverage(hitNoteObj.actualTone, hitNoteObj.samples, note);

  hitNotesByPlayerTicks[player][tickData.tick] = {
    actualTone: newAverage,
    samples: hitNoteObj.samples + 1,
    expectedTone: tickData.currentLine[tickData.lyricRef.syllableIndex].tone,
  };

  let startLineTick = tickData.currentLine && tickData.currentLine[0] ? tickData.currentLine[0].start : 0;
  for (let [key] of Object.entries(hitNotesByPlayerTicks[player])) {
    if (key < startLineTick) {
      delete hitNotesByPlayerTicks[player][key];
    }
  }

  return hitNotesByPlayerTicks;
};
