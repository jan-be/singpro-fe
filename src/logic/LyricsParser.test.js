import { describe, it, expect } from 'vitest';
import { readTextFile } from './LyricsParser';

const notes = lyricLines => lyricLines.flat().filter(el => !el.isBreak);

describe('readTextFile', () => {
  it('parses every UltraStar note type, with the rap and golden flags', async () => {
    const chart = ['#BPM:100', '#GAP:0', ': 0 2 10 It ', '* 2 2 12 gold', 'F 4 2 14 free', 'R 6 2 10 rap', 'G 8 2 10 grap', 'E'].join('\n');
    const ld = await readTextFile(chart);
    const all = notes(ld.lyricLines);
    expect(all.map(n => n.syllable)).toEqual(['It ', 'gold', 'free', 'rap', 'grap']);
    expect(all.map(n => n.isRap)).toEqual([false, false, false, true, true]);
    expect(all.map(n => n.isSpecial)).toEqual([false, true, false, false, true]);
    expect(all[3]).toMatchObject({ start: 6, length: 2, tone: 10 });
    expect(ld.lyricRefs[7]).toEqual({ lineIndex: 0, syllableIndex: 4, isSilent: false });
    expect(ld.isDuet).toBe(false);
  });

  it('keeps a rapped second voice of a duet (In the End: P2 is rap notes only)', async () => {
    const chart = ['#BPM:210.1', '#GAP:18720', 'P1', ': 0 2 10 It ', '- 4', 'P2', 'R 20 2 10 One ', 'R 24 3 10 thing ', '- 30', 'R 30 1 10 I ', 'E'].join('\n');
    const ld = await readTextFile(chart);
    expect(ld.isDuet).toBe(true);
    expect(notes(ld.p2.lyricLines).map(n => n.syllable)).toEqual(['One ', 'thing ', 'I ']);
    expect(ld.p2.lyricLines).toHaveLength(2); // the opening line, then one per break
    expect(ld.p2.lyricRefs[25]).toMatchObject({ lineIndex: 0, syllableIndex: 2, isSilent: false });
    expect(ld.p2.lyricRefs[30]).toMatchObject({ lineIndex: 1, syllableIndex: 1, isSilent: false });
    expect(ld.duetSingers).toEqual({ p1: null, p2: null });
  });

  it('reads the singers\' names off a duet chart, from either header spelling, and none off a solo', async () => {
    const duet = ['#BPM:100', '#DUETSINGERP1:Elton John', '#DUETSINGERP2: Kiki Dee ', 'P1', ': 0 2 10 Don\'t ', 'P2', ': 4 2 10 go ', 'E'].join('\n');
    expect((await readTextFile(duet)).duetSingers).toEqual({ p1: 'Elton John', p2: 'Kiki Dee' });
    const short = ['#BPM:100', '#P1:Him', '#P2:Her', 'P1', ': 0 2 10 a ', 'P2', ': 4 2 10 b ', 'E'].join('\n');
    expect((await readTextFile(short)).duetSingers).toEqual({ p1: 'Him', p2: 'Her' });
    const solo = ['#BPM:100', '#P1:Nobody', ': 0 2 10 a ', 'E'].join('\n');
    expect((await readTextFile(solo)).duetSingers).toBe(null);
  });
});
