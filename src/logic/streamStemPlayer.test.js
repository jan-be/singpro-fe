import { describe, it, expect, vi } from 'vitest';
import { StreamingStemPlayer } from './streamStemPlayer';

// A stand-in <audio>: events by name, play() that can be refused, seeks that report back
function fakeElement() {
  const listeners = {};
  const el = {
    paused: true, currentTime: 0, duration: NaN, error: null, seeking: false, src: '', played: 0,
    addEventListener(type, fn) { (listeners[type] ??= []).push(fn); },
    emit(type) { const fns = listeners[type] ?? []; listeners[type] = []; fns.forEach((f) => f()); },
    play: vi.fn(() => { el.paused = false; el.played++; return el.refuse ? (el.paused = true, Promise.reject(Object.assign(new Error('no'), { name: 'NotAllowedError' }))) : Promise.resolve(); }),
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
      const g = { connect() {}, disconnect() {}, events: [] };
      g.gain = { value: 1, cancelScheduledValues() {}, setValueAtTime(v) { g.gain.value = v; }, linearRampToValueAtTime(v) { g.events.push(v); g.gain.value = v; } };
      return g;
    },
    createMediaElementSource(el) { return { el, connect() {}, disconnect() {} }; },
  };
}
const gains = { karaoke: {}, vocals: {} };

async function loaded() {
  const els = [];
  const player = new StreamingStemPlayer(fakeContext(), gains, { createElement: () => { const e = fakeElement(); els.push(e); return e; } });
  const p = player.load({ karaoke: '/k', vocals: '/v' });
  els.forEach((e) => { e.duration = 165; e.emit('canplay'); });
  await p;
  return { player, k: els[0], v: els[1] };
}

describe('StreamingStemPlayer', () => {
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

  it('starts both a little ahead of the song time, as long as a start takes to be heard', async () => {
    const { player, k, v } = await loaded();
    player.play(42);
    expect(k.currentTime).toBeCloseTo(42 + player.leads.start, 6);
    expect(v.currentTime).toBe(k.currentTime);
    expect(player.playing).toBe(true);
    expect(player.waiting).toBe(true); // not heard yet: no drift to chase
    k.emit('playing');
    expect(player.waiting).toBe(false);
    k.currentTime = 50;
    expect(player.currentTime).toBe(50);
    player.pause();
    expect(player.playing).toBe(false);
    expect(k.pause).toHaveBeenCalled();
    expect(v.pause).toHaveBeenCalled();
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

  it('jumps both while playing, faded out and back in around the seek', async () => {
    const { player, k, v } = await loaded();
    player.play(10);
    k.emit('playing');
    player.seek(80);
    expect(k.currentTime).toBeCloseTo(80 + player.leads.seek, 6);
    expect(v.currentTime).toBe(k.currentTime);
    expect(player.fades.karaoke.gain.value).toBe(0);
    k.emit('seeked');
    expect(player.fades.karaoke.gain.value).toBe(1);
  });

  it('puts the vocals back on the instrumental after a stall parted them', async () => {
    const { player, k, v } = await loaded();
    player.play(0);
    k.currentTime = 30; v.currentTime = 30.02;
    expect(player.realign()).toBe(false); // within tolerance
    k.emit('playing'); // the start is heard
    v.currentTime = 29.5; // the vocals waited for data
    expect(player.realign()).toBe(true);
    expect(v.currentTime).toBeCloseTo(30 + player.leads.seek, 6); // aimed ahead by a seek's lag
    v.currentTime = 29.5;
    expect(player.realign()).toBe(false); // not again before that move is heard
    expect(k.currentTime).toBe(30); // the instrumental is not touched
  });

  it('lets go of both files when disposed', async () => {
    const { player, k, v } = await loaded();
    player.play(0);
    player.dispose();
    expect(k.src).toBe('');
    expect(v.src).toBe('');
    expect(player.loaded).toBe(false);
  });

  it('learns its leads from how far off a start or seek came out', async () => {
    const { player, k } = await loaded();
    Object.assign(player.leads, { start: 0.1, seek: 0.05 }); // shared by every player: a known starting point
    player.play(0);
    player.learn(0.3); // not heard yet: nothing to learn
    expect(player.leads.start).toBe(0.1);
    k.emit('playing');
    player.learn(0.3); // came out 0.3 s behind the clock
    expect(player.leads.start).toBeCloseTo(0.31, 6);
    player.learn(0.3); // only the first check after a jump counts
    expect(player.leads.start).toBeCloseTo(0.31, 6);
    player.seek(20);
    k.emit('seeked');
    player.learn(-0.1); // the seek came out 0.1 s ahead: aim less far
    expect(player.leads.seek).toBe(0);
    player.pause();
    player.play(5);
    expect(k.currentTime).toBeCloseTo(5.31, 6);
  });
});
