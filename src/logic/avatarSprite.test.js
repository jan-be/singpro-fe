import { describe, it, expect } from 'vitest';
import { createAvatarSprites, drawAvatar } from './avatarSprite.js';
import { defaultHue } from './playerColor.js';

/** A canvas stand-in that writes down what is drawn on it. */
function fakeCanvas(px) {
  const calls = [];
  const ctx = new Proxy({ calls }, {
    get(target, prop) {
      if (prop === 'calls') return calls;
      if (prop === 'measureText') return (text) => { calls.push(['measureText', text]); return { actualBoundingBoxAscent: 10, actualBoundingBoxDescent: 0 }; };
      if (prop in target) return target[prop];
      return (...args) => calls.push([prop, ...args]);
    },
    set(target, prop, value) { calls.push([`=${String(prop)}`, value]); target[prop] = value; return true; },
  });
  return { width: px, height: px, getContext: () => ctx, calls };
}

/** An image loader the test resolves by hand. */
function manualLoader() {
  const pending = new Map();
  const load = (src) => new Promise((resolve, reject) => pending.set(src, { resolve, reject }));
  return { load, pending };
}

const flush = () => new Promise(r => setTimeout(r, 0));
const picture = { naturalWidth: 256, naturalHeight: 256 };

describe('avatarSprite', () => {
  it('without a picture: the letter on the player colour, at the size asked for', () => {
    const sprites = createAvatarSprites({ createCanvas: fakeCanvas, loadImage: () => new Promise(() => {}) });
    const s = sprites.get({ username: 'anna', hue: 215, px: 48 });
    expect(s.width).toBe(48);
    expect(s.calls).toContainEqual(['=fillStyle', 'hsl(215, 100%, 55%)']);
    expect(s.calls.find(c => c[0] === 'fillText')[1]).toBe('A');
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

  it('a hue left out is the shared default for the name', () => {
    const sprites = createAvatarSprites({ createCanvas: fakeCanvas, loadImage: () => new Promise(() => {}) });
    const s = sprites.get({ username: 'Bob', px: 32 });
    expect(s.calls).toContainEqual(['=fillStyle', `hsl(${defaultHue('Bob')}, 100%, 55%)`]);
  });

  it('the letter until the picture is in, then the picture in the ring; listeners hear about it', async () => {
    const { load, pending } = manualLoader();
    const sprites = createAvatarSprites({ createCanvas: fakeCanvas, loadImage: load });
    const ready = [];
    sprites.onReady(src => ready.push(src));
    const src = '/api/users/4/avatar?v=1';
    const before = sprites.get({ username: 'Ann', src, hue: 140, px: 40 });
    expect(before.calls.some(c => c[0] === 'fillText')).toBe(true);
    pending.get(src).resolve(picture);
    await flush();
    expect(ready).toEqual([src]);
    const after = sprites.get({ username: 'Ann', src, hue: 140, px: 40 });
    expect(after).not.toBe(before);
    expect(after.calls.some(c => c[0] === 'clip')).toBe(true);
    const draw = after.calls.find(c => c[0] === 'drawImage');
    expect(draw[1]).toBe(picture);
    expect(after.calls.some(c => c[0] === 'fillText')).toBe(false);
    expect(pending.size).toBe(1); // loaded once
  });

  it('a picture that cannot be loaded stays the letter', async () => {
    const { load, pending } = manualLoader();
    const sprites = createAvatarSprites({ createCanvas: fakeCanvas, loadImage: load });
    const src = '/api/users/9/avatar?v=2';
    sprites.preload(src);
    pending.get(src).reject(new Error('404'));
    await flush();
    const s = sprites.get({ username: 'Zed', src, hue: 65, px: 40 });
    expect(s.calls.find(c => c[0] === 'fillText')[1]).toBe('Z');
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
    drawAvatar(c.getContext('2d'), { px: 64, hue: 20, picture: { naturalWidth: 300, naturalHeight: 200 }, letter: 'X' });
    const draw = c.calls.find(x => x[0] === 'drawImage');
    expect(draw.slice(2, 6)).toEqual([50, 0, 200, 200]);
  });
});
