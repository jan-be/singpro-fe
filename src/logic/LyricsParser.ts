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

export const getLyricsAroundTick = (tick: number): string[] => {
  let arr = [];
  let tickBefore = tick;
  let tickAfter = tick + 1;
  for (let i = 0; i < 4; i++) {
    let lyricType = getLyricAroundTick(tickBefore, true);
    if (lyricType) {
      arr.push(lyricType.syllable);
      // @ts-ignore
      tickBefore = lyricType.start - 1;
    } else {
      break;
    }
  }
  arr.reverse();

  for (let i = 0; i < 6; i++) {
    let lyricType = getLyricAroundTick(tickAfter, false);
    if (lyricType) {
      arr.push(lyricType.syllable);
      // @ts-ignore
      tickAfter = lyricType.start + 1;
    }
  }

  // @ts-ignore
  return arr;
};

export const getLyricAroundTick = (tick: number, before: boolean): LyricType => {
  const lyrics = store.getState().lyricData.lyrics;

  if (before) {
    for (let i = tick; i >= 0; i--) {
      let lyric = lyrics[i];
      if (lyric) {
        return lyric
      }
    }
  } else {
    for (let i = tick; i < lyrics.length; i++) {
      let lyric = lyrics[i];
      if (lyric) {
        return lyric
      }
    }
  }
  return {isBreak: false};

};
