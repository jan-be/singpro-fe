import { describe, test, expect } from 'vitest';
import { readTextFile } from './LyricsParser';
import { scriptChoice, withScript, songNames } from './lyricsScripts';

const chart = (...syllables) => `#BPM:300\n#GAP:1000\n${syllables.map((s, i) => (s === '-' ? `- ${i * 4}` : `: ${i * 4} 3 2 ${s}`)).join('\n')}\nE`;

describe('scriptChoice', () => {
  const zh = { Hans: 'a', Hant: 'b' };

  test('Chinese readers get their own variant by default, others the romanised chart', () => {
    expect(scriptChoice(zh, { locale: 'zh' })).toEqual({ tag: 'Hans', on: true });
    expect(scriptChoice(zh, { locale: 'zh-TW' })).toEqual({ tag: 'Hant', on: true });
    expect(scriptChoice(zh, { locale: 'en' })).toEqual({ tag: 'Hans', on: false });
    expect(scriptChoice(zh, { locale: 'de', language: 'Cantonese' })).toEqual({ tag: 'Hant', on: false });
  });

  test('a script matching the UI language is on; an earlier choice wins either way', () => {
    expect(scriptChoice({ Jpan: 'x' }, { locale: 'ja' })).toEqual({ tag: 'Jpan', on: true });
    expect(scriptChoice({ Cyrl: 'x' }, { locale: 'en' })).toEqual({ tag: 'Cyrl', on: false });
    expect(scriptChoice({ Cyrl: 'x' }, { locale: 'en', saved: { Cyrl: true } }).on).toBe(true);
    expect(scriptChoice({ Jpan: 'x' }, { locale: 'ja', saved: { Jpan: false } }).on).toBe(false);
    expect(scriptChoice(zh, { locale: 'zh', saved: { Hani: false } }).on).toBe(false);
  });

  test('no scripts, nothing to offer', () => {
    expect(scriptChoice(undefined, { locale: 'zh' })).toEqual({ tag: null, on: false });
    expect(scriptChoice({}, { locale: 'zh' }).tag).toBe(null);
  });
});

describe('withScript', () => {
  test('the text comes from the script chart, everything else stays', async () => {
    const base = await readTextFile(chart('Qing ', 'tian', '-', 'gu~', 'shi'));
    const script = await readTextFile(chart('晴', '天', '-', '~', '事'));
    const ld = withScript(base, script);
    expect(ld.lyricLines.map(l => l.map(e => e.syllable).join(''))).toEqual(['晴天', '~事']);
    expect(ld.lyricRefs).toBe(base.lyricRefs);
    expect(ld.lyricLines[1][1]).toMatchObject({ start: 12, tone: 2, length: 3 });
    expect(base.lyricLines[1].map(e => e.syllable).join('')).toBe('gu~shi');
  });

  test('a chart that does not line up is not used', async () => {
    const base = await readTextFile(chart('Qing ', 'tian', '-', 'gu', 'shi'));
    expect(withScript(base, await readTextFile(chart('晴', '天', '故', '事')))).toBe(base);
  });
});

describe('songNames', () => {
  const qingTian = { artist: 'Jay Chou', title: 'Qing Tian', language: 'Mandarin',
    titles: { Hans: { title: '晴天' }, Hant: { title: '晴天' } } };

  test('in their own script for whoever reads the lyrics so, a name without a spelling stays as charted', () => {
    expect(songNames(qingTian, { locale: 'zh', saved: {} })).toEqual({ title: '晴天', artist: 'Jay Chou', lang: 'zh-Hans', roman: 'Jay Chou – Qing Tian' });
    expect(songNames(qingTian, { locale: 'en', saved: {} })).toEqual({ title: 'Qing Tian', artist: 'Jay Chou' });
    expect(songNames(qingTian, { locale: 'en', saved: { Hani: true } }).title).toBe('晴天');
  });

  test('songs without names in another script, and no song at all', () => {
    expect(songNames({ artist: 'A', title: 'T' }, { locale: 'zh', saved: {} })).toEqual({ title: 'T', artist: 'A' });
    expect(songNames(null, { locale: 'zh', saved: {} })).toEqual({ title: undefined, artist: undefined });
  });
});
