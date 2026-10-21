/** One sung note of a chart (`:` normal, `*` golden, `F` freestyle, `R` rap, `G` golden rap), in ticks */
export interface LyricNote {
  isBreak: false;
  /** golden (`*`, `G`) */
  isSpecial: boolean;
  /** rap (`R`, `G`): any voiced pitch hits its nominal tone */
  isRap: boolean;
  /** freestyle (`F`): not scored, its tone a placeholder */
  isFreestyle: boolean;
  /** first tick */
  start: number;
  /** ticks */
  length: number;
  /** the chart's pitch, semitones */
  tone: number;
  syllable: string;
}

/** A line break (`- start`), and the element every lyric line opens with: length 0, tone 0, no syllable */
export interface LyricBreak {
  isBreak: true;
  start: number;
  length: number;
  tone: number;
  syllable: string;
  isSpecial: boolean;
  isRap?: undefined;
  isFreestyle?: undefined;
}

/** What a lyric line holds: its opening break, then its notes */
export type LyricElement = LyricNote | LyricBreak;

/** One line of lyrics: `[break, ...notes]` */
export type LyricLine = LyricElement[];

/** Where a tick is in the chart: the element at lyricLines[lineIndex][syllableIndex]; a silent tick points at the next sung one */
export interface LyricRef {
  lineIndex: number;
  syllableIndex: number;
  isSilent: boolean;
}

/** One part's notes: its lines and, per tick, where that tick is in them */
export interface LyricTrack {
  lyricLines: LyricLine[];
  lyricRefs: LyricRef[];
}

/** A part with the song's timing: what getTickData reads, and the lyricData of P2's tick data */
export interface TimedLyrics extends LyricTrack {
  /** UltraStar's #BPM times 4: ticks a minute */
  bpm: number;
  /** ms into the video where tick 0 is (the timing in use, which the host may correct) */
  gap: number;
  /** the gap the chart plays at by itself */
  defaultGap: number;
}

/** Who sings which part of a duet, when the chart says (#DUETSINGERP1 / #P1 headers) */
export interface DuetSingers {
  p1: string | null;
  p2: string | null;
}

/** A parsed UltraStar chart (readTextFile): P1's part (the whole chart when it is no duet) plus P2's */
export interface LyricData extends TimedLyrics {
  isDuet: boolean;
  p2: LyricTrack | null;
  duetSingers: DuetSingers | null;
}

/** Where the song is at a moment (getTickData, getP2TickData) */
export interface TickData<L extends TimedLyrics = TimedLyrics> {
  /** the line sung now ([] before the chart has any) */
  currentLine: LyricLine;
  /** the one after it (undefined past the last line) */
  nextLine: LyricLine | undefined;
  lyricRef: LyricRef | undefined;
  /** ticks since the gap, 0 before it */
  tickFloat: number;
  /** ticks since the gap, negative before it */
  rawTickFloat: number;
  tick: number;
  lyricData: L;
  /** the video time this frame is for, s */
  videoTime: number;
}

/**
 * Split raw UltraStar lines into per-player note arrays.
 * Non-duet files (no P1/P2 markers) return { p1: allLines, p2: null }.
 * Duet files split at P1/P2 markers and return both tracks.
 */
function splitDuetLines(rawLines: string[]): { p1: string[]; p2: string[] | null } {
  const noteLines = rawLines.filter(l => !l.startsWith('#'));
  const hasP1 = noteLines.some(l => l.trimEnd() === 'P1');
  const hasP2 = noteLines.some(l => l.trimEnd() === 'P2');

  if (!hasP1 || !hasP2) {
    return { p1: noteLines.filter(l => l.trimEnd() !== 'P1' && l.trimEnd() !== 'P2'), p2: null };
  }

  const p1: string[] = [];
  const p2: string[] = [];
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
function parseNoteLines(noteLines: string[]): LyricTrack {
  let lyrics: LyricElement[] = [];
  let minTone = 1e100;

  for (let line of noteLines) {
    let firstChar = line.charAt(0);
    // ':' normal, '*' golden, 'F' freestyle, 'R' rap, 'G' golden rap. A rap
    // note carries a nominal tone; any voiced pitch counts as hitting it. A
    // freestyle note is not scored at all.
    if (firstChar === ":" || firstChar === "*" || firstChar === "F" || firstChar === "R" || firstChar === "G") {
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
        isSpecial: firstChar === "*" || firstChar === "G",
        isRap: firstChar === "R" || firstChar === "G",
        // sung however the singer likes, its tone a placeholder (singspree-be scoring.ts)
        isFreestyle: firstChar === "F",
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

  let lyricLines: LyricLine[] = [[{ isBreak: true, start: 0, length: 0, tone: 0, syllable: "", isSpecial: false }]];

  for (let lyric of lyrics) {
    if (lyric.isBreak) {
      lyricLines.push([lyric]);
    } else {
      lyricLines[lyricLines.length - 1].push(lyric);
    }
  }

  let lyricRefs: LyricRef[] = [];

  for (let i = 0; i < lyricLines.length; i++) {
    for (let j = 0; j < lyricLines[i].length; j++) {
      let tmpEl = lyricLines[i][j];

      for (let k = 0; k < tmpEl.length; k++) {
        lyricRefs[tmpEl.start + k] = { lineIndex: i, syllableIndex: j, isSilent: false };
      }
    }
  }

  // fill up the undefined ones: a silent tick points at the next sung one.
  // One pass from the end, one object per silence: looking ahead from every
  // silent tick was quadratic in the gap (~10 ms per parse here, a few hundred
  // on a TV stick, at every song start)
  let silent: LyricRef | null = null;
  for (let i = lyricRefs.length - 1; i >= 0; i--) {
    if (lyricRefs[i]) { silent = null; continue; }
    if (!silent) silent = { ...lyricRefs[i + 1], isSilent: true };
    lyricRefs[i] = silent;
  }

  return { lyricLines, lyricRefs };
}

export const readTextFile = async (fileContent: string): Promise<LyricData> => {
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

  // Who sings which part, when the chart says (#DUETSINGERP1 / #P1 headers): "Elton John", "Kiki Dee"
  const header = (key: string) => lines.find(l => l.startsWith(`#${key}:`))?.slice(key.length + 2).trim() || null;
  const duetSingers = p2Data ? { p1: header('DUETSINGERP1') ?? header('P1'), p2: header('DUETSINGERP2') ?? header('P2') } : null;

  return {
    lyricLines: p1Data.lyricLines,
    lyricRefs: p1Data.lyricRefs,
    bpm,
    gap,
    defaultGap: gap,
    isDuet: p2Data !== null,
    p2: p2Data,
    duetSingers,
  };
};

export const secSinceStartToTickFloat = (lyricData: Pick<TimedLyrics, 'bpm' | 'gap'>, secSinceStart: number): number => {
  return (lyricData.bpm / 60) * (secSinceStart - lyricData.gap / 1000)
}

/**
 * Where the song is at `secSinceStart`: its line, syllable and tick.
 * `tickFloat` stops at 0 before the gap; `rawTickFloat` runs on below it, for
 * the note highway's cursor, which comes in ahead of a first note at tick 0.
 */
export const getTickData = <L extends TimedLyrics>(lyricData: L, secSinceStart: number): TickData<L> => {
  let lyricRef: LyricRef | undefined = undefined;
  let currentLine: LyricLine = [];
  let nextLine: LyricLine | undefined = [];

  const rawTickFloat = secSinceStartToTickFloat(lyricData, secSinceStart);
  let tickFloat = Math.max(0, rawTickFloat);
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

  // videoTime: the moment this frame is for. The tick stands at 0 until the
  // song's gap, so whatever shows where the song is (the timeline) reads this.
  return { currentLine, nextLine, lyricRef, tickFloat, rawTickFloat, tick, lyricData, videoTime: secSinceStart };
};

/**
 * Compute tick data for the P2 (second singer) track of a duet.
 * Uses the same bpm/gap as the main lyricData but references the P2 lyricLines/lyricRefs.
 */
export const getP2TickData = (lyricData: LyricData | null | undefined, secSinceStart: number): TickData | null => {
  if (!lyricData?.p2) return null;

  const p2 = lyricData.p2;
  let lyricRef: LyricRef | undefined = undefined;
  let currentLine: LyricLine = [];
  let nextLine: LyricLine | undefined = [];

  const rawTickFloat = secSinceStartToTickFloat(lyricData, secSinceStart);
  let tickFloat = Math.max(0, rawTickFloat);
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
  const p2LyricData: TimedLyrics = {
    lyricLines: p2.lyricLines,
    lyricRefs: p2.lyricRefs,
    bpm: lyricData.bpm,
    gap: lyricData.gap,
    defaultGap: lyricData.defaultGap,
  };

  return { currentLine, nextLine, lyricRef, tickFloat, rawTickFloat, tick, lyricData: p2LyricData, videoTime: secSinceStart };
};
