import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StreamingStemPlayer } from './streamStemPlayer';

// A stand-in <audio>: events by name, play() that can be refused, seeks that report back
function fakeElement() {
  const listeners = {};
  const el = {
    paused: true, currentTime: 0, duration: NaN, error: null, seeking: false, readyState: 4, src: '',
    addEventListener(type, fn) { (listeners[type] ??= []).push(fn); },
    emit(type) { const fns = listeners[type] ?? []; listeners[type] = []; fns.forEach((f) => f()); },
    play: vi.fn(() => { el.paused = false; return el.refuse ? (el.paused = true, Promise.reject(Object.assign(new Error('no'), { name: 'NotAllowedError' }))) : Promise.resolve(); }),
    pause: vi.fn(() => { el.paused = true; }),
    removeAttribute(name) { if (name === 'src') el.src = ''; },
    load() {},
  };
  return el;
}
function fakeContext() {
  return {
    currentTime: 0,
    createGain() {
      const g = { connect() {}, disconnect() {} };
      g.gain = { value: 1, cancelScheduledValues() {}, setValueAtTime(v) { g.gain.value = v; }, linearRampToValueAtTime(v) { g.gain.value = v; } };
      return g;
    },
    createMediaElementSource(el) { return { el, connect() {}, disconnect() {} }; },
  };
}
const gains = { karaoke: {}, vocals: {} };

async function loaded(clockValue = { t: null }) {
  const els = [];
  const player = new StreamingStemPlayer(fakeContext(), gains, {
    createElement: () => { const e = fakeElement(); els.push(e); return e; },
    clock: () => clockValue.t,
  });
  Object.assign(player.leads, { start: 0, seek: 0 }); // shared by every player: a known starting point
  const p = player.load({ karaoke: '/k', vocals: '/v' });
  els.forEach((e) => { e.duration = 165; e.emit('canplay'); });
  await p;
  return { player, k: els[0], v: els[1], clock: clockValue };
}
const audible = (player) => player.fades.karaoke.gain.value === 1 && player.fades.vocals.gain.value === 1;

describe('StreamingStemPlayer', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'] }); });
  afterEach(() => { vi.useRealTimers(); });

  it('is loaded once both elements can play, and decodes nothing ahead', async () => {
    const els = [];
    const player = new StreamingStemPlayer(fakeContext(), gains, { createElement: () => { const e = fakeElement(); els.push(e); return e; } });
    const p = player.load({ karaoke: '/k', vocals: '/v' });
    expect(els.map((e) => e.src)).toEqual(['/k', '/v']);
    els[0].emit('canplay');
    expect(player.loaded).toBe(false);
    els[1].emit('canplay');
    await p;
    expect(player.loaded).toBe(true);
    expect(player.decodedBytes).toBe(0);
  });

  it('fails when an element cannot play its file, naming the stem', async () => {
    const els = [];
    const player = new StreamingStemPlayer(fakeContext(), gains, { createElement: () => { const e = fakeElement(); els.push(e); return e; } });
    const p = player.load({ karaoke: '/k', vocals: '/v' });
    els[1].error = { code: 4 };
    els[1].emit('error');
    await expect(p).rejects.toThrow('vocals: cannot play (media error 4)');
  });

  it('starts faded out and fades in once heard on the clock', async () => {
    const { player, k, v, clock } = await loaded();
    clock.t = 42;
    player.play(42);
    expect(k.currentTime).toBe(42);
    expect(v.currentTime).toBe(42);
    expect(player.playing).toBe(true);
    expect(player.waiting).toBe(true); // nothing for the page's sync to chase
    expect(audible(player)).toBe(false);
    vi.advanceTimersByTime(300);
    expect(audible(player)).toBe(false); // not heard yet
    k.emit('playing');
    k.currentTime = 42.3; clock.t = 42.32; // heard, 20 ms off
    vi.advanceTimersByTime(100);
    expect(audible(player)).toBe(true);
    expect(player.waiting).toBe(false);
  });

  it('moves again quietly while it is off, and learns how far ahead to aim', async () => {
    const { player, k, clock } = await loaded();
    clock.t = 10;
    player.play(10);
    k.emit('playing');
    clock.t = 10.4; k.currentTime = 10.1; // came out 0.3 s behind
    vi.advanceTimersByTime(100);
    expect(audible(player)).toBe(false); // still hidden
    expect(player.leads.start).toBeCloseTo(0.21, 6); // 70 % of the 0.3 s
    expect(k.currentTime).toBeCloseTo(10.4, 6); // moved to the clock (+ the seek lead, 0 so far)
    k.emit('seeked');
    clock.t = 10.6; k.currentTime = 10.57;
    vi.advanceTimersByTime(100);
    expect(audible(player)).toBe(true);
    // the next start aims ahead by what it learned
    player.pause();
    clock.t = 20;
    player.play(20);
    expect(k.currentTime).toBeCloseTo(20.21, 6);
  });

  it('fades in after two seconds even if it never sits on the clock', async () => {
    const { player, k, clock } = await loaded();
    clock.t = 0;
    player.play(0);
    vi.advanceTimersByTime(2100);
    expect(audible(player)).toBe(true);
    expect(k.paused).toBe(false);
  });

  it('reads as paused when the browser refuses to play without a tap', async () => {
    const { player, k, v } = await loaded();
    k.refuse = v.refuse = true;
    player.play(0);
    await Promise.resolve();
    expect(player.playing).toBe(false); // the silence watchdog offers "tap for sound"
    k.refuse = v.refuse = false;
    player.play(0); // inside the tap
    expect(player.playing).toBe(true);
  });

  it('jumps both while playing, hidden until they are heard there', async () => {
    const { player, k, v, clock } = await loaded();
    clock.t = 10;
    player.play(10);
    k.emit('playing');
    vi.advanceTimersByTime(100);
    expect(audible(player)).toBe(true);
    player.seek(80);
    expect(k.currentTime).toBe(80);
    expect(v.currentTime).toBe(80);
    expect(audible(player)).toBe(false);
    k.emit('seeked');
    clock.t = 80.02; k.currentTime = 80.01;
    vi.advanceTimersByTime(100);
    expect(audible(player)).toBe(true);
  });

  it('puts the vocals back on the instrumental after a stall parted them', async () => {
    const { player, k, v, clock } = await loaded();
    clock.t = 0;
    player.play(0);
    k.emit('playing');
    vi.advanceTimersByTime(100); // heard: audible
    k.currentTime = 30; v.currentTime = 30.02;
    expect(player.realign()).toBe(false); // within tolerance
    v.currentTime = 29.5; // the vocals waited for data
    expect(player.realign()).toBe(true);
    expect(v.currentTime).toBeCloseTo(30 + player.leads.seek, 6);
    expect(k.currentTime).toBe(30); // the instrumental is not touched
    v.currentTime = 29.5;
    expect(player.realign()).toBe(false); // not again before that move is heard
  });

  it('lets go of both files when disposed', async () => {
    const { player, k, v } = await loaded();
    player.play(0);
    player.dispose();
    expect(k.src).toBe('');
    expect(v.src).toBe('');
    expect(player.loaded).toBe(false);
  });
});
