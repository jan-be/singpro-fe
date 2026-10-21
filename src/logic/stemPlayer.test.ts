import { describe, it, expect, assert } from 'vitest';
import { StemPlayer, silentWav, type MixNode, type StemGains } from './stemPlayer';

interface FakeGain {
  events: unknown[][];
  to?: MixNode;
  gain: { value: number; setValueAtTime(v: number, t: number): void; linearRampToValueAtTime(v: number, t: number): void; cancelScheduledValues(): void };
  connect(n: MixNode): void;
}
interface FakeSource {
  buffer: AudioBuffer | null;
  started: { when: number; offset: number } | null;
  stopped: number | null;
  onended: (() => void) | null;
  to?: FakeGain;
  connect(n: FakeGain): void;
  start(when: number, offset: number): void;
  stop(when: number): void;
}

// A stand-in AudioContext that records what was scheduled
function fakeContext() {
  const sources: FakeSource[] = [];
  return {
    currentTime: 0,
    sources,
    createBufferSource() {
      const s: FakeSource = { buffer: null, started: null, stopped: null, onended: null, connect(n) { s.to = n; }, start(when, offset) { s.started = { when, offset }; }, stop(when) { s.stopped = when; } };
      sources.push(s);
      return s;
    },
    createGain() {
      const events: unknown[][] = [];
      const g: FakeGain = {
        events,
        gain: { value: 1, setValueAtTime(v, t) { g.gain.value = v; events.push(['set', v, t]); }, linearRampToValueAtTime(v, t) { events.push(['ramp', v, t]); }, cancelScheduledValues() {} },
        connect(n) { g.to = n; },
      };
      return g;
    },
    decodeAudioData: (): Promise<AudioBuffer> => Promise.reject(new Error('the tests decode with their own')),
  };
}
// (the stand-ins go in where the page's gains would)
const mixNode = (name: string) => ({ name, connect() {} });
const gains: StemGains = { karaoke: mixNode('kGain'), vocals: mixNode('vGain') };
const fetchOk = (bytes: number) => async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(bytes) });
// An AudioBuffer of the length a file of `bytes` decodes to here (its samples are not read)
const decode = async (bytes: ArrayBuffer): Promise<AudioBuffer> => ({
  duration: bytes.byteLength / 1000, length: bytes.byteLength * 48, numberOfChannels: 2, sampleRate: 48000,
  copyFromChannel() {}, copyToChannel() {}, getChannelData: () => new Float32Array(0),
});
/** The fade a source plays into */
const fadeOf = (s: FakeSource) => { assert(s.to, 'the source is not connected'); return s.to; };

async function loaded() {
  const ctx = fakeContext();
  const player = new StemPlayer(ctx, gains);
  await player.load({ karaoke: '/k', vocals: '/v' }, { fetchImpl: fetchOk(272000), decode });
  return { ctx, player };
}

describe('StemPlayer', () => {
  it('loads both stems and reports what it decoded', async () => {
    const ctx = fakeContext();
    const player = new StemPlayer(ctx, gains);
    const lines: string[] = [];
    expect(player.loaded).toBe(false);
    await player.load({ karaoke: '/k', vocals: '/v' }, { fetchImpl: fetchOk(272000), decode, log: (l) => lines.push(l) });
    expect(player.loaded).toBe(true);
    expect(player.duration).toBe(272);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^karaoke: 0\.3 MB in \d+ ms, decoded 272\.0 s \/ 2 ch \/ 48000 Hz in \d+ ms$/);
    // float32 samples: 272 s x 48 kHz x 2 channels x 4 bytes, twice
    expect(player.decodedBytes).toBe(2 * 272 * 48000 * 2 * 4);
  });

  it('fails on an HTTP error and on a file it cannot decode, naming the stem', async () => {
    const player = new StemPlayer(fakeContext(), gains);
    await expect(player.load({ karaoke: '/k', vocals: '/v' }, { fetchImpl: async () => ({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) }), decode })).rejects.toThrow('karaoke: HTTP 404');
    await expect(player.load({ karaoke: '/k', vocals: '/v' }, { fetchImpl: fetchOk(10), decode: async () => { throw new Error('bad'); } })).rejects.toThrow('karaoke: cannot decode (bad)');
    expect(player.loaded).toBe(false);
  });

  it('starts both stems together at the song time and keeps time on the context clock', async () => {
    const { ctx, player } = await loaded();
    ctx.currentTime = 100;
    player.play(10);
    expect(player.playing).toBe(true);
    expect(ctx.sources.map(s => s.started)).toEqual([{ when: 100, offset: 10 }, { when: 100, offset: 10 }]);
    expect(ctx.sources.map(s => fadeOf(s).to)).toEqual([gains.karaoke, gains.vocals]);
    expect(fadeOf(ctx.sources[0]).gain.value).toBe(1); // a first start needs no fade-in
    ctx.currentTime = 105.5;
    expect(player.currentTime).toBeCloseTo(15.5);
  });

  it('pauses where it is and resumes from there', async () => {
    const { ctx, player } = await loaded();
    ctx.currentTime = 100;
    player.play(10);
    ctx.currentTime = 105;
    player.pause();
    expect(player.playing).toBe(false);
    expect(player.currentTime).toBe(15);
    expect(ctx.sources.every(s => s.stopped !== null && s.stopped > 105 && s.stopped < 105.1)).toBe(true);
    ctx.currentTime = 200;
    expect(player.currentTime).toBe(15);
    player.play();
    expect(ctx.sources[2].started).toEqual({ when: 200, offset: 15 });
  });

  it('seeks while playing by restarting there, crossfading over the old pair', async () => {
    const { ctx, player } = await loaded();
    ctx.currentTime = 100;
    player.play(10);
    ctx.currentTime = 105;
    player.seek(200);
    expect(player.currentTime).toBe(200);
    expect(ctx.sources).toHaveLength(4);
    expect(ctx.sources[2].started).toEqual({ when: 105, offset: 200 });
    expect(ctx.sources[0].stopped).toBeGreaterThan(105);
    expect(fadeOf(ctx.sources[0]).events.at(-1)).toEqual(['ramp', 0, 105.02]); // the old pair fades out
    expect(fadeOf(ctx.sources[2]).events).toEqual([['set', 0, 105], ['ramp', 1, 105.02]]); // the new one fades in
    ctx.currentTime = 107;
    expect(player.currentTime).toBe(202);
  });

  it('seeks while paused by moving the position', async () => {
    const { ctx, player } = await loaded();
    player.seek(42);
    expect(player.currentTime).toBe(42);
    expect(ctx.sources).toHaveLength(0);
    player.play();
    expect(ctx.sources[0].started?.offset).toBe(42);
  });

  it('knows when the song ran out', async () => {
    const { ctx, player } = await loaded();
    player.play(270);
    const ended = ctx.sources[0].onended;
    assert(ended, 'no ended handler');
    ended();
    expect(player.ended).toBe(true);
    expect(player.playing).toBe(false);
    expect(player.currentTime).toBe(272);
    player.seek(0);
    expect(player.ended).toBe(false);
  });

  it('dispose drops the audio, also when it arrives afterwards', async () => {
    const { player } = await loaded();
    player.play(1);
    player.dispose();
    expect(player.playing).toBe(false);
    expect(player.loaded).toBe(false);
    const late = new StemPlayer(fakeContext(), gains);
    const loading = late.load({ karaoke: '/k', vocals: '/v' }, { fetchImpl: fetchOk(1000), decode });
    late.dispose();
    await loading;
    expect(late.loaded).toBe(false);
  });
});

describe('silentWav', () => {
  it('is a well-formed second of 8 kHz 16-bit mono silence', () => {
    const buf = silentWav();
    const v = new DataView(buf);
    const tag = (o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
    expect([tag(0), tag(8), tag(12), tag(36)]).toEqual(['RIFF', 'WAVE', 'fmt ', 'data']);
    expect(buf.byteLength).toBe(44 + 16000);
    expect(v.getUint32(40, true)).toBe(16000);
    expect(v.getUint32(24, true)).toBe(8000);
    expect(new Uint8Array(buf, 44).every(b => b === 0)).toBe(true);
  });
});
