export const readTextFile = async fileUrl => {
  let resp = await fetch(fileUrl);
  let file = await resp.text();
  file = file.replace(/\r/g, "");
  let lines = file.split("\n");

  const bpm = parseFloat(
    lines.filter((line => line.startsWith("#BPM:")))[0]
      .split(":")[1]
      .replace(',', '.')) * 4;

  const gap = parseFloat(
    lines.filter((line => line.startsWith("#GAP:")))[0]
      .split(":")[1]
      .replace(',', '.'));

  lines = lines.filter((line => !line.startsWith("#")));

  let lyrics = [];

  for (let line of lines) {
    let firstChar = line.charAt(0);
    if (firstChar === ":" || firstChar === "*") {
      let secondB = line.indexOf(' ', 2);
      let thirdB = line.indexOf(' ', secondB + 1);
      let fourthB = line.indexOf(' ', thirdB + 1);

      let start = parseInt(line.substring(2, secondB));
      let length = parseInt(line.substring(secondB, thirdB));
      let tone = parseInt(line.substring(thirdB, fourthB));
      let syllable = line.substring(fourthB + 1);

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
        length: 0, syllable: "", isSpecial: false, tone: 0
      })
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
        lyricRefs[tmpEl.start + k] = { lineIndex: i, syllableIndex: j, isSilent: false }
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

  return { lyricLines, lyricRefs, bpm, gap };
};

export const getTickData = (lyricData, tick) => {
  let lyricRef = undefined;
  let currentLine = [];
  let nextLine = [];

  if (lyricData.lyricRefs && lyricData.lyricRefs.length > 0) {
    lyricRef = lyricData.lyricRefs[tick];
  }
  if (lyricRef) {
    currentLine = lyricData.lyricLines[lyricRef.lineIndex];
    nextLine = lyricData.lyricLines[lyricRef.lineIndex + 1];
  }

  return { currentLine, nextLine, lyricRef, tick };
};
