import { describe, it, expect, assert } from 'vitest';
import { createAvatarSprites, drawAvatar, type AvatarPen, type AvatarPicture } from './avatarSprite';
import { defaultHue } from './playerColor';

/** A canvas stand-in that writes down what is drawn on it: calls as [name, ...args], settings as ['=name', value]. */
function fakeCanvas(px: number) {
  const calls: unknown[][] = [];
  const call = (name: string) => (...args: unknown[]) => { calls.push([name, ...args]); };
  const set = (name: string) => (value: unknown) => { calls.push([`=${name}`, value]); };
  const ctx: AvatarPen = {
    clearRect: call('clearRect'), beginPath: call('beginPath'), arc: call('arc'), fill: call('fill'), save: call('save'), clip: call('clip'),
    restore: call('restore'), stroke: call('stroke'), fillText: call('fillText'), drawImage: call('drawImage'),
    measureText: (text) => { calls.push(['measureText', text]); return { actualBoundingBoxAscent: 10, actualBoundingBoxDescent: 0 }; },
    set fillStyle(v: string) { set('fillStyle')(v); },
    set strokeStyle(v: string) { set('strokeStyle')(v); },
    set lineWidth(v: number) { set('lineWidth')(v); },
    set font(v: string) { set('font')(v); },
    set textAlign(v: CanvasTextAlign) { set('textAlign')(v); },
    set textBaseline(v: CanvasTextBaseline) { set('textBaseline')(v); },
  };
  return { width: px, height: px, getContext: (_contextId?: '2d') => ctx, calls };
}

/** The first call to `name`, as [name, ...args] */
const callTo = (calls: unknown[][], name: string) => {
  const c = calls.find(x => x[0] === name);
  assert(c, `no ${name}`);
  return c;
};

/** An image loader the test resolves by hand. */
function manualLoader() {
  const pending = new Map<string, { resolve: (image: AvatarPicture) => void; reject: (err: Error) => void }>();
  const load = (src: string) => new Promise<AvatarPicture>((resolve, reject) => pending.set(src, { resolve, reject }));
  /** The load of `src` under way */
  const loading = (src: string) => { const p = pending.get(src); assert(p, `${src} is not loading`); return p; };
  return { load, pending, loading };
}

const flush = () => new Promise(r => setTimeout(r, 0));
/** A bitmap stand-in: as much of a picture as drawAvatar reads */
const bitmap = (width: number, height: number): ImageBitmap => ({ width, height, close() {} });
const picture = bitmap(256, 256);

describe('avatarSprite', () => {
  it('without a picture: the letter on the player colour, at the size asked for', () => {
    const sprites = createAvatarSprites({ createCanvas: fakeCanvas, loadImage: () => new Promise(() => {}) });
    const s = sprites.get({ username: 'anna', hue: 215, px: 48 });
    expect(s.width).toBe(48);
    expect(s.calls).toContainEqual(['=fillStyle', 'hsl(215, 100%, 55%)']);
    expect(callTo(s.calls, 'fillText')[1]).toBe('A');
    expect(s.calls.some(c => c[0] === 'drawImage')).toBe(false);
  });

  it('kept: the same player, colour and size is the same canvas; another size or colour is another', () => {
    const sprites = createAvatarSprites({ createCanvas: fakeCanvas, loadImage: () => new Promise(() => {}) });
    const a = sprites.get({ username: 'Anna', hue: 215, px: 48 });
    expect(sprites.get({ username: 'Anna', hue: 215, px: 48 })).toBe(a);
    expect(sprites.get({ username: 'Anna', hue: 215, px: 47.6 })).toBe(a); // device pixels are rounded
    expect(sprites.get({ username: 'Anna', hue: 215, px: 96 })).not.toBe(a);
    expect(sprites.get({ username: 'Anna', hue: 20, px: 48 })).not.toBe(a);
    expect(sprites.size).toBe(3);
  });

  it('two letters are a sprite of their own; the one-letter sprite stays as it was', () => {
    const sprites = createAvatarSprites({ createCanvas: fakeCanvas, loadImage: () => new Promise(() => {}) });
    const one = sprites.get({ username: 'Bea', hue: 20, px: 48 });
    const two = sprites.get({ username: 'Bea', hue: 20, px: 48, letters: 'Ba' });
    expect(two).not.toBe(one);
    expect(callTo(two.calls, 'fillText')[1]).toBe('Ba');
    expect(callTo(one.calls, 'fillText')[1]).toBe('B');
    expect(sprites.get({ username: 'Bea', hue: 20, px: 48, letters: 'Ba' })).toBe(two);
    expect(sprites.get({ username: 'Bea', hue: 20, px: 48 })).toBe(one);
  });

  it('a hue left out is the shared default for the name', () => {
    const sprites = createAvatarSprites({ createCanvas: fakeCanvas, loadImage: () => new Promise(() => {}) });
    const s = sprites.get({ username: 'Bob', px: 32 });
    expect(s.calls).toContainEqual(['=fillStyle', `hsl(${defaultHue('Bob')}, 100%, 55%)`]);
  });

  it('the letter until the picture is in, then the picture in the ring; listeners hear about it', async () => {
    const { load, pending, loading } = manualLoader();
    const sprites = createAvatarSprites({ createCanvas: fakeCanvas, loadImage: load });
    const ready: string[] = [];
    sprites.onReady(src => ready.push(src));
    const src = '/api/users/4/avatar?v=1';
    const before = sprites.get({ username: 'Ann', src, hue: 140, px: 40 });
    expect(before.calls.some(c => c[0] === 'fillText')).toBe(true);
    loading(src).resolve(picture);
    await flush();
    expect(ready).toEqual([src]);
    const after = sprites.get({ username: 'Ann', src, hue: 140, px: 40 });
    expect(after).not.toBe(before);
    expect(after.calls.some(c => c[0] === 'clip')).toBe(true);
    const draw = callTo(after.calls, 'drawImage');
    expect(draw[1]).toBe(picture);
    expect(after.calls.some(c => c[0] === 'fillText')).toBe(false);
    expect(pending.size).toBe(1); // loaded once
  });

  it('a picture that cannot be loaded stays the letter', async () => {
    const { load, loading } = manualLoader();
    const sprites = createAvatarSprites({ createCanvas: fakeCanvas, loadImage: load });
    const src = '/api/users/9/avatar?v=2';
    sprites.preload(src);
    loading(src).reject(new Error('404'));
    await flush();
    const s = sprites.get({ username: 'Zed', src, hue: 65, px: 40 });
    expect(callTo(s.calls, 'fillText')[1]).toBe('Z');
  });

  it('keeps at most maxSprites, dropping the least recently used', () => {
    const sprites = createAvatarSprites({ createCanvas: fakeCanvas, loadImage: () => new Promise(() => {}), maxSprites: 2 });
    const a = sprites.get({ username: 'A', hue: 20, px: 32 });
    sprites.get({ username: 'B', hue: 20, px: 32 });
    expect(sprites.get({ username: 'A', hue: 20, px: 32 })).toBe(a); // A used again: B is now the oldest
    sprites.get({ username: 'C', hue: 20, px: 32 });
    expect(sprites.size).toBe(2);
    expect(sprites.get({ username: 'A', hue: 20, px: 32 })).toBe(a);
  });

  it('drawAvatar crops a non-square picture to its middle', () => {
    const c = fakeCanvas(64);
    drawAvatar(c.getContext('2d'), { px: 64, hue: 20, picture: bitmap(300, 200), letter: 'X' });
    const draw = callTo(c.calls, 'drawImage');
    expect(draw.slice(2, 6)).toEqual([50, 0, 200, 200]);
  });
});
