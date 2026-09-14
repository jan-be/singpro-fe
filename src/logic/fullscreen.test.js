import { describe, it, expect, afterEach, vi } from 'vitest';
import { exitFullscreen } from './fullscreen.js';

const asDocument = props => vi.stubGlobal('document', props);

describe('exitFullscreen', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('exits when the page is fullscreen', () => {
    const spy = vi.fn(() => Promise.resolve());
    asDocument({ fullscreenElement: {}, exitFullscreen: spy });
    exitFullscreen();
    expect(spy).toHaveBeenCalledOnce();
  });

  it('does nothing when the page is not fullscreen', () => {
    const spy = vi.fn();
    asDocument({ fullscreenElement: null, exitFullscreen: spy });
    exitFullscreen();
    expect(spy).not.toHaveBeenCalled();
  });

  it('falls back to the webkit spelling', () => {
    const spy = vi.fn();
    asDocument({ fullscreenElement: null, webkitFullscreenElement: {}, webkitExitFullscreen: spy });
    exitFullscreen();
    expect(spy).toHaveBeenCalledOnce();
  });

  it('swallows a rejected exit and a browser that refuses outright', () => {
    asDocument({ fullscreenElement: {}, exitFullscreen: () => Promise.reject(new Error('denied')) });
    expect(() => exitFullscreen()).not.toThrow();
    asDocument({ fullscreenElement: {}, exitFullscreen: () => { throw new Error('nope'); } });
    expect(() => exitFullscreen()).not.toThrow();
  });
});
