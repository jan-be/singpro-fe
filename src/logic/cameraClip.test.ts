import { describe, it, expect } from 'vitest';
import {
  cameraAction, cropFor, cutChunks, dropAfter, flvFile, lyricLinesIn, createFootageStore,
  CAMERA_IDLE_GRACE_MS, FOOTAGE_KEEP_MS, FOOTAGE_MAX, type CameraChunk, type CameraSegment, type CameraTrack,
} from './cameraClip';
import type { LyricData, LyricElement } from './LyricsParser';

const s = (over = {}) => ({ open: true, opening: false, needed: false, hidden: false, idleMs: 0, ...over });

describe('cameraAction', () => {
  it('opens only when needed in a visible tab, and not twice', () => {
    expect(cameraAction(s({ open: false, needed: true }))).toBe('open');
    expect(cameraAction(s({ open: false, needed: true, hidden: true }))).toBeNull();
    expect(cameraAction(s({ open: false, needed: true, opening: true }))).toBeNull();
    expect(cameraAction(s({ open: false }))).toBeNull();
  });

  it('closes at once in a background tab, even while the song plays', () => {
    expect(cameraAction(s({ needed: true, hidden: true }))).toBe('close');
  });

  it('keeps it over a short pause or seek, then closes', () => {
    expect(cameraAction(s({ needed: true }))).toBeNull();
    expect(cameraAction(s({ idleMs: CAMERA_IDLE_GRACE_MS - 1 }))).toBeNull();
    expect(cameraAction(s({ idleMs: CAMERA_IDLE_GRACE_MS }))).toBe('close');
  });
});

describe('cropFor', () => {
  it('takes a 16:9 camera whole', () => {
    expect(cropFor(1280, 720)).toEqual({ sx: 0, sy: 0, sw: 1280, sh: 720 });
  });
  it('takes the middle of a portrait one (a phone held upright) at 16:9', () => {
    expect(cropFor(720, 1280)).toEqual({ sx: 0, sy: 438, sw: 720, sh: 405 });
  });
  it('takes the middle of one wider than 16:9; nothing of no picture', () => {
    expect(cropFor(1000, 400)).toEqual({ sx: 145, sy: 0, sw: 711, sh: 400 });
    expect(cropFor(0, 0)).toEqual({ sx: 0, sy: 0, sw: 0, sh: 0 });
  });
  it('another shape on request', () => {
    expect(cropFor(1280, 720, 540, 960)).toEqual({ sx: 438, sy: 0, sw: 405, sh: 720 });
  });
});

const track: CameraTrack = { description: new Uint8Array([1, 0x42, 0xe0, 0x1f]) };
/** A chunk a second; a keyframe every `keyEvery` */
const film = (n: number, { from = 10, step = 0.25, keyEvery = 4, tr = track } = {}): CameraChunk[] =>
  Array.from({ length: n }, (_, i) => ({ t: from + i * step, key: i % keyEvery === 0, data: new Uint8Array([i]), track: tr }));

describe('cutChunks', () => {
  it('starts at the keyframe before the moment and ends at its end', () => {
    const cut = cutChunks(film(40), 12.6, 15.1); // keyframes at 10, 11, 12, 13 …
    expect(cut[0].t).toBe(12);
    expect(cut[0].key).toBe(true);
    expect(cut[cut.length - 1].t).toBe(15);
  });

  it('starts at the first keyframe when the filming began after the moment did', () => {
    const cut = cutChunks(film(40, { from: 20 }), 18, 22);
    expect(cut[0].t).toBe(20);
    expect(cut[cut.length - 1].t).toBe(22);
  });

  it('nothing when nothing of the moment was filmed', () => {
    expect(cutChunks(film(8), 30, 40)).toEqual([]);
    expect(cutChunks([], 0, 10)).toEqual([]);
  });

  it('stays in one stream, and never steps back in time', () => {
    const other: CameraTrack = { description: new Uint8Array([9]) };
    const chunks = [...film(8, { from: 10 }), ...film(8, { from: 12, tr: other })];
    expect(cutChunks(chunks, 10, 20).every(c => c.track === track)).toBe(true);
    const hiccup = film(8);
    hiccup.splice(3, 0, { t: 10.1, key: false, data: new Uint8Array([99]), track });
    const cut = cutChunks(hiccup, 10, 20);
    expect(cut.map(c => c.t)).toEqual([...cut.map(c => c.t)].sort((a, b) => a - b));
    expect(cut.some(c => c.data[0] === 99)).toBe(false);
  });
});

describe('dropAfter', () => {
  it('keeps what was filmed before a rewind', () => {
    expect(dropAfter(film(8), 11).map(c => c.t)).toEqual([10, 10.25, 10.5, 10.75]);
  });
});

describe('flvFile', () => {
  it('writes the FLV header, the decoder configuration and one tag per frame with its time in ms', () => {
    const chunks = film(3, { from: 5, step: 0.5, keyEvery: 2 });
    const f = flvFile(track, chunks);
    const view = new DataView(f.buffer);
    expect(String.fromCharCode(f[0], f[1], f[2])).toBe('FLV');
    expect(f[4]).toBe(0x01); // video only
    expect(view.getUint32(5)).toBe(9);
    const tags: { type: number; size: number; ms: number; first: number; packet: number }[] = [];
    let at = 13;
    while (at < f.length) {
      const size = (f[at + 1] << 16) | (f[at + 2] << 8) | f[at + 3];
      const ms = ((f[at + 7] << 24) | (f[at + 4] << 16) | (f[at + 5] << 8) | f[at + 6]) >>> 0;
      tags.push({ type: f[at], size, ms, first: f[at + 11], packet: f[at + 12] });
      expect(view.getUint32(at + 11 + size)).toBe(11 + size); // the previous tag's size after it
      at += 11 + size + 4;
    }
    expect(at).toBe(f.length);
    expect(tags.map(t => t.ms)).toEqual([0, 0, 500, 1000]);
    expect(tags.map(t => t.first)).toEqual([0x17, 0x17, 0x27, 0x17]); // key / inter, AVC
    expect(tags.map(t => t.packet)).toEqual([0, 1, 1, 1]);
    expect(tags[0].size).toBe(5 + track.description.length);
  });
});

describe('lyricLinesIn', () => {
  const note = (start: number, length: number, syllable: string, golden = false): LyricElement =>
    ({ isBreak: false, isSpecial: golden, isRap: false, isFreestyle: false, start, length, tone: 0, syllable });
  const brk = (start: number): LyricElement => ({ isBreak: true, start, length: 0, tone: 0, syllable: '', isSpecial: false });
  // 600 ticks a minute: a tick is 0.1 s; the gap 2 s
  const ld = {
    bpm: 600, gap: 2000, defaultGap: 2000, lyricRefs: [], isDuet: false, p2: null, duetSingers: null,
    lyricLines: [
      [brk(0), note(0, 5, 'One '), note(5, 5, 'line', true)],
      [brk(20), note(20, 10, 'Two '), note(30, 5, 'more')],
      [brk(100), note(100, 5, 'Far '), note(105, 5, 'away')],
    ],
  } as unknown as LyricData;

  it('the lines sung in the moment, their syllables in song seconds', () => {
    const lines = lyricLinesIn(ld, 3, 5);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toEqual({ start: 2, end: 3, syllables: [
      { text: 'One ', start: 2, end: 2.5, golden: false }, { text: 'line', start: 2.5, end: 3, golden: true }] });
    expect(lines[1].start).toBe(4);
    expect(lines[1].end).toBeCloseTo(5.5);
  });
  it('nothing without a chart', () => {
    expect(lyricLinesIn(null, 0, 100)).toEqual([]);
  });
});

describe('footage store', () => {
  const seg = (id: string, madeAt: number): CameraSegment => ({ recordingId: id, songId: 's', track, chunks: [], start: 0, end: 1, lyrics: [], madeAt });

  it('keeps moments for a while, then lets them go', () => {
    let now = 1_000;
    const store = createFootageStore(() => now);
    store.put(seg('a', now));
    expect(store.get('a')?.recordingId).toBe('a');
    now += FOOTAGE_KEEP_MS + 1;
    expect(store.get('a')).toBeNull();
    expect(store.count()).toBe(0);
  });

  it('keeps the newest FOOTAGE_MAX; clear deletes all and says so', () => {
    const store = createFootageStore(() => 0);
    let changes = 0;
    store.subscribe(() => { changes++; });
    for (let i = 0; i <= FOOTAGE_MAX; i++) store.put(seg(`t${i}`, 0));
    expect(store.count()).toBe(FOOTAGE_MAX);
    expect(store.get('t0')).toBeNull();
    store.clear();
    expect(store.count()).toBe(0);
    expect(changes).toBe(FOOTAGE_MAX + 2);
  });
});
