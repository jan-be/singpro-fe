import { readTextFile, type LyricData, type LyricTrack, type LyricLine } from './LyricsParser';

// Romanised charts in their own script. The API sends song.lyricsScripts,
// {Hans: chart, Hant: chart, …} (ISO 15924 tags), made by singspree-chartgen from
// the song's original-script lyrics: the same notes and timing with other text.
// Display only: the server keeps scoring by the chart the host sends, and each
// viewer picks for themselves (nothing goes over the party connection).

/** A viewer's own choice per script, as saved: {Jpan: true, Hani: false, …} */
export type ScriptChoices = Record<string, boolean>;

/** Which of a song's scripts is offered (tag null: none) and whether it shows */
export type ScriptChoice = { tag: null; on: false } | { tag: string; on: boolean };

/** A song's names in one script (API song.titles[tag]) */
export interface ScriptTitles {
  title?: string;
  artist?: string;
}

/** What songNames reads off a song (an API song) */
export interface SongNamesSource {
  title?: string;
  artist?: string;
  language?: string;
  titles?: Record<string, ScriptTitles> | null;
}

/** A song's names as a viewer reads them (songNames) */
export interface SongNames {
  title: string | undefined;
  artist: string | undefined;
  /** for lang="" when the names are in a script */
  lang?: string;
  /** the charted pair, when the names shown differ */
  roman?: string;
}

// What the pill shows to switch to a script; 'Latn' is the chart as written
export const SCRIPT_LABELS: Record<string, string> = {
  Hans: '汉字', Hant: '漢字', Jpan: '日本語', Kore: '한글', Cyrl: 'АБВ', Grek: 'ΑΒΓ', Deva: 'देवनागरी', Latn: 'ABC',
};

// lang="" for text in a script, so CJK fonts draw the Han characters the way
// that language writes them (直, 骨 differ between Chinese and Japanese)
export const SCRIPT_LANG: Partial<Record<string, string>> = { Hans: 'zh-Hans', Hant: 'zh-Hant', Jpan: 'ja', Kore: 'ko', Grek: 'el', Deva: 'hi' };

// The UI language whose readers expect a script by default
const LOCALE_SCRIPT: Partial<Record<string, string>> = { zh: 'Hans', 'zh-TW': 'Hant', ja: 'Jpan', ko: 'Kore', ru: 'Cyrl', hi: 'Deva' };

const KEY = 'singspree.lyricsScript'; // {Jpan: true, Hani: false, …}: a viewer's own choice per script
const savedKey = (tag: string) => (tag === 'Hans' || tag === 'Hant' ? 'Hani' : tag); // both Chinese variants: one choice

export function loadScriptChoices(): ScriptChoices {
  try { return JSON.parse(localStorage.getItem(KEY) as string) ?? {}; } catch { return {}; } // (null parses as null)
}

export function saveScriptChoice(tag: string, on: boolean) {
  try { localStorage.setItem(KEY, JSON.stringify({ ...loadScriptChoices(), [savedKey(tag)]: on })); } catch { /* private mode */ }
}

/**
 * Which of a song's scripts to offer (tag null: none) and whether it shows
 * from the start: the viewer's earlier choice for that script, else on when
 * the UI is in a language written in it. Chinese comes in both variants: the
 * viewer's (Taiwan/Hong Kong UI: traditional), else traditional for Cantonese.
 */
export function scriptChoice(scripts: object | null | undefined, { locale, language, saved = {} }: { locale?: string; language?: string; saved?: ScriptChoices } = {}): ScriptChoice {
  const tags = Object.keys(scripts ?? {});
  if (!tags.length) return { tag: null, on: false };
  let tag = tags[0];
  const chinese = tags.filter(t => t === 'Hans' || t === 'Hant');
  if (chinese.length) {
    const want = locale === 'zh-TW' || (locale !== 'zh' && language === 'Cantonese') ? 'Hant' : 'Hans';
    tag = chinese.includes(want) ? want : chinese[0];
  }
  const native = LOCALE_SCRIPT[locale as string] === tag || (chinese.length > 0 && (locale === 'zh' || locale === 'zh-TW')); // (no locale: no script)
  return { tag, on: saved[savedKey(tag)] ?? native };
}

/**
 * `base` (readTextFile of the chart) with the syllable text of `script` (the
 * same chart in another script, parsed the same way). Only the text changes,
 * so lyricRefs, ticks and tones stay valid; a chart that does not line up
 * note for note is left as it is.
 */
export function withScript(base: LyricData, script: LyricData): LyricData {
  const overlay = <T extends LyricTrack>(a: T | null, b: LyricTrack | null): T | null => {
    if (!a || !b || a.lyricLines.length !== b.lyricLines.length) return null;
    const lines: LyricLine[] = [];
    for (let i = 0; i < a.lyricLines.length; i++) {
      const line = a.lyricLines[i], other = b.lyricLines[i];
      if (line.length !== other.length) return null;
      const out: LyricLine = [];
      for (let j = 0; j < line.length; j++) {
        if (line[j].start !== other[j].start || line[j].isBreak !== other[j].isBreak) return null;
        out.push(line[j].isBreak ? line[j] : { ...line[j], syllable: other[j].syllable });
      }
      lines.push(out);
    }
    return { ...a, lyricLines: lines };
  };
  const p1 = overlay(base, script);
  if (!p1) return base;
  const p2 = base.p2 ? overlay(base.p2, script.p2) : null;
  return { ...p1, p2: p2 ?? base.p2 };
}

/**
 * A song's title and artist as a viewer reads them: in the song's own script
 * (API: song.titles, {Hans: {title: '晴天', artist}, …}) when they would see
 * its lyrics in that script, else as charted. A name the converter found no
 * spelling for stays as charted ("Jay Chou – 晴天"). `lang` is for lang="",
 * `roman` the charted pair (a tooltip) when the names shown differ.
 */
export function songNames(song: SongNamesSource | null | undefined, { locale, saved = loadScriptChoices() }: { locale?: string; saved?: ScriptChoices } = {}): SongNames {
  const { tag, on } = scriptChoice(song?.titles, { locale, language: song?.language, saved });
  const own = on ? song!.titles![tag] : null;
  if (!own) return { title: song?.title, artist: song?.artist };
  return {
    title: own.title || song!.title,
    artist: own.artist || song!.artist,
    lang: SCRIPT_LANG[tag!],
    roman: `${song!.artist} – ${song!.title}`,
  };
}

/** The chart as a viewer sees it: parsed, in the script they chose when there is one */
export async function parseShown(lyrics: string, scripts: Record<string, string> | null | undefined, choice: ScriptChoice | null | undefined): Promise<LyricData> {
  const ld = await readTextFile(lyrics);
  const script = choice?.on && scripts?.[choice.tag];
  return script ? withScript(ld, await readTextFile(script)) : ld;
}
