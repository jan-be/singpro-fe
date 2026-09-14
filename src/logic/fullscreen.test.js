import { describe, it, expect, afterEach, vi } from 'vitest';
import { exitFullscreen, enterFullscreen, toggleFullscreen, isFullscreen, fullscreenSupported } from './fullscreen.js';

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

describe('enterFullscreen / toggleFullscreen', () => {
  afterEach(() => vi.unstubAllGlobals());

  const doc = (docProps, elProps) => vi.stubGlobal('document', { ...docProps, documentElement: elProps });

  it('enters through the standard API', () => {
    const req = vi.fn(() => Promise.resolve());
    doc({ fullscreenElement: null }, { requestFullscreen: req });
    enterFullscreen();
    expect(req).toHaveBeenCalledOnce();
  });

  it('enters through the webkit spelling when that is all there is', () => {
    const req = vi.fn();
    doc({ fullscreenElement: null }, { webkitRequestFullscreen: req });
    expect(fullscreenSupported()).toBe(true);
    enterFullscreen();
    expect(req).toHaveBeenCalledOnce();
  });

  it('toggles both ways', () => {
    const req = vi.fn(() => Promise.resolve());
    const exit = vi.fn(() => Promise.resolve());
    doc({ fullscreenElement: null, exitFullscreen: exit }, { requestFullscreen: req });
    expect(isFullscreen()).toBe(false);
    toggleFullscreen();
    expect(req).toHaveBeenCalledOnce();

    doc({ fullscreenElement: {}, exitFullscreen: exit }, { requestFullscreen: req });
    expect(isFullscreen()).toBe(true);
    toggleFullscreen();
    expect(exit).toHaveBeenCalledOnce();
    expect(req).toHaveBeenCalledOnce(); // not again
  });

  it('reports no support when the browser has neither spelling', () => {
    doc({ fullscreenElement: null }, {});
    expect(fullscreenSupported()).toBe(false);
    expect(() => toggleFullscreen()).not.toThrow();
  });
});
