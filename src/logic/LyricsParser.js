/**
 * Split raw UltraStar lines into per-player note arrays.
 * Non-duet files (no P1/P2 markers) return { p1: allLines, p2: null }.
 * Duet files split at P1/P2 markers and return both tracks.
 */
function splitDuetLines(rawLines) {
  const noteLines = rawLines.filter(l => !l.startsWith('#'));
  const hasP1 = noteLines.some(l => l.trimEnd() === 'P1');
  const hasP2 = noteLines.some(l => l.trimEnd() === 'P2');

  if (!hasP1 || !hasP2) {
    return { p1: noteLines.filter(l => l.trimEnd() !== 'P1' && l.trimEnd() !== 'P2'), p2: null };
  }

  const p1 = [];
  const p2 = [];
  let currentPlayer = 1;

  for (const line of noteLines) {
    const trimmed = line.trimEnd();
    if (trimmed === 'P1') { currentPlayer = 1; continue; }
    if (trimmed === 'P2') { currentPlayer = 2; continue; }
    if (currentPlayer === 1) p1.push(line);
    else p2.push(line);
  }

  return { p1, p2 };
}

/**
 * Parse an array of UltraStar note lines into lyricLines + lyricRefs.
 */
function parseNoteLines(noteLines) {
  let lyrics = [];
  let minTone = 1e100;

  for (let line of noteLines) {
    let firstChar = line.charAt(0);
    if (firstChar === ":" || firstChar === "*" || firstChar === "F") {
      let secondB = line.indexOf(' ', 2);
      let thirdB = line.indexOf(' ', secondB + 1);
      let fourthB = line.indexOf(' ', thirdB + 1);

      let start = parseInt(line.substring(2, secondB));
      let length = parseInt(line.substring(secondB, thirdB));
      let tone = parseInt(line.substring(thirdB, fourthB));
      let syllable = line.substring(fourthB + 1);

      minTone = Math.min(minTone, tone);

      lyrics.push({
        isBreak: false,
        isSpecial: firstChar === "*",
        start,
        length,
        tone,
        syllable,
      });
    } else if (firstChar === "-") {
      let start = parseInt(line.split(" ")[1]);

      lyrics.push({
        isBreak: true,
        start,
        length: 0, syllable: "", isSpecial: false, tone: 0,
      });
    }
  }

  let lyricLines = [[{ isBreak: true, start: 0, length: 0, tone: 0, syllable: "", isSpecial: false }]];

  for (let lyric of lyrics) {
    if (lyric.isBreak) {
      lyricLines.push([lyric]);
    } else {
      lyricLines[lyricLines.length - 1].push(lyric);
    }
  }

  let lyricRefs = [];

  for (let i = 0; i < lyricLines.length; i++) {
    for (let j = 0; j < lyricLines[i].length; j++) {
      let tmpEl = lyricLines[i][j];

      for (let k = 0; k < tmpEl.length; k++) {
        lyricRefs[tmpEl.start + k] = { lineIndex: i, syllableIndex: j, isSilent: false };
      }
    }
  }

  // fill up the undefined ones
  for (let i = 0; i < lyricRefs.length; i++) {
    for (let j = i; j < lyricRefs.length; j++) {
      if (!lyricRefs[i] && lyricRefs[j]) {
        lyricRefs[i] = { ...lyricRefs[j], isSilent: true };
        break;
      }
    }
  }

  return { lyricLines, lyricRefs };
}

export const readTextFile = async fileContent => {
  let file = fileContent.replace(/\r/g, "");
  let lines = file.split("\n");

  const bpm = parseFloat(
    lines.filter((line => line.startsWith("#BPM:")))[0]
      .split(":")[1]
      .replace(',', '.')) * 4;

  const gap = parseFloat(
    ((lines.filter((line => line.startsWith("#GAP:")))[0]) ?? "#GAP:0")
      .split(":")[1]
      .replace(',', '.'));

  const { p1, p2 } = splitDuetLines(lines);

  const p1Data = parseNoteLines(p1);
  const p2Data = p2 ? parseNoteLines(p2) : null;

  return {
    lyricLines: p1Data.lyricLines,
    lyricRefs: p1Data.lyricRefs,
    bpm,
    gap,
    defaultGap: gap,
    isDuet: p2Data !== null,
    p2: p2Data,
  };
};

export const secSinceStartToTickFloat = (lyricData, secSinceStart) => {
  return (lyricData.bpm / 60) * (secSinceStart - lyricData.gap / 1000)
}

export const getTickData = (lyricData, secSinceStart) => {
  let lyricRef = undefined;
  let currentLine = [];
  let nextLine = [];

  let tickFloat = secSinceStartToTickFloat(lyricData, secSinceStart);

  tickFloat = Math.max(0, tickFloat);
  let tick = Math.floor(tickFloat);

  if (lyricData.lyricRefs && lyricData.lyricRefs.length > 0) {
    // Clamp tick so the last line stays visible after the final syllable ends
    const clampedTick = Math.min(tick, lyricData.lyricRefs.length - 1);
    lyricRef = lyricData.lyricRefs[clampedTick];
  }
  if (lyricRef) {
    currentLine = lyricData.lyricLines[lyricRef.lineIndex];
    nextLine = lyricData.lyricLines[lyricRef.lineIndex + 1];
  }

  return { currentLine, nextLine, lyricRef, tickFloat, tick, lyricData };
};

/**
 * Compute tick data for the P2 (second singer) track of a duet.
 * Uses the same bpm/gap as the main lyricData but references the P2 lyricLines/lyricRefs.
 */
export const getP2TickData = (lyricData, secSinceStart) => {
  if (!lyricData?.p2) return null;

  const p2 = lyricData.p2;
  let lyricRef = undefined;
  let currentLine = [];
  let nextLine = [];

  let tickFloat = secSinceStartToTickFloat(lyricData, secSinceStart);
  tickFloat = Math.max(0, tickFloat);
  let tick = Math.floor(tickFloat);

  if (p2.lyricRefs && p2.lyricRefs.length > 0) {
    const clampedTick = Math.min(tick, p2.lyricRefs.length - 1);
    lyricRef = p2.lyricRefs[clampedTick];
  }
  if (lyricRef) {
    currentLine = p2.lyricLines[lyricRef.lineIndex];
    nextLine = p2.lyricLines[lyricRef.lineIndex + 1];
  }

  // Build a virtual lyricData for P2 that shares bpm/gap but has its own lines/refs
  const p2LyricData = {
    lyricLines: p2.lyricLines,
    lyricRefs: p2.lyricRefs,
    bpm: lyricData.bpm,
    gap: lyricData.gap,
    defaultGap: lyricData.defaultGap,
  };

  return { currentLine, nextLine, lyricRef, tickFloat, tick, lyricData: p2LyricData };
};
