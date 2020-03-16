import store from "../state/store";
import {setLyricData} from "../state/actions";

export type LyricType = {
  isBreak: boolean,
  isSpecial: boolean,
  start: number,
  length: number,
  tone: number,
  syllable: string,
};

export type LyricRefType = {
  line: LyricType[],
  syllableIndex: number,
}

export const readTextFile = async (fileUrl: string): Promise<void> => {
  let resp = await fetch(fileUrl);
  let file = await resp.text();
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

  let lyrics: LyricType[] = [];

  for (let line of lines) {
    let firstChar = line.charAt(0);
    if (firstChar === ":" || firstChar === "*") {
      let secondB = line.indexOf(' ', 2);
      let thrirdB = line.indexOf(' ', secondB + 1);
      let fourthB = line.indexOf(' ', thrirdB + 1);

      let start = parseInt(line.substring(2, secondB));
      let length = parseInt(line.substring(secondB, thrirdB));
      let tone = parseInt(line.substring(thrirdB, fourthB));
      let syllable = line.substring(fourthB);

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

  // @ts-ignore
  let lyricLines: LyricType[][] = [[{isBreak: true}]];

  for (let lyric of lyrics) {
    if (lyric.isBreak) {
      lyricLines.push([lyric]);
    } else {
      lyricLines[lyricLines.length - 1].push(lyric);
    }
  }

  // @ts-ignore
  let lyricRefs: LyricRefType[] = [];

  for (let i = 0; i < lyricLines.length; i++) {
    for (let j = 0; j < lyricLines[i].length; j++) {
      let hmm = lyricLines[i][j];

      for (let k = 0; k < hmm.length; k++) {
        lyricRefs[hmm.start + k] = {line: lyricLines[i], syllableIndex: j}
      }
    }
  }

  store.dispatch(setLyricData(lyrics, lyricRefs, bpm, gap));
};
