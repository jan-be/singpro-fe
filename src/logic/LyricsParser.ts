import store from "../state/store";
import {setLyricData} from "../state/actions";

export type LyricType = {
  isBreak: boolean,
  isSpecial?: boolean,
  start?: number,
  length?: number,
  tone?: number,
  syllable?: string,
};

export const readTextFile = async (fileUrl: string): Promise<void> => {
  let resp = await fetch(fileUrl);
  let file = await resp.text();
  let lines = file.split("\n");

  const bpm = parseFloat(
    lines.filter((line => line.startsWith("#BPM:")))[0]
      .split(":")[1]
      .replace(',', '.'));

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

      lyrics[start] = {
        isBreak: false,
        isSpecial: firstChar === "*",
        start,
        length,
        tone,
        syllable,
      };
    } else if (firstChar === "-") {
      lyrics.push({isBreak: true})
    }
  }

  store.dispatch(setLyricData(lyrics, bpm, gap));
};

export const getLyricForTick = (tick: number): string => {
  for (let i = tick; i >= 0; i--) {
    let lyric = (store.getState().lyricData.lyrics[i]);
    if (lyric) {
      return lyric.syllable
    }
  }
  return "";
};
