import { describe, it, expect } from 'vitest';
import { browserCoversVideos } from './videoTakeover';

describe('browserCoversVideos', () => {
  it('knows the TCL browser by the objects it adds to the page', () => {
    expect(browserCoversVideos({ videoDetect: { sendVideoInfo() {} } })).toBe(true);
    expect(browserCoversVideos({ PlayerControlsInterface: { fullscreenClick() {} } })).toBe(true);
  });
  it('is false anywhere else', () => {
    expect(browserCoversVideos({})).toBe(false);
    expect(browserCoversVideos(undefined)).toBe(false);
  });
});
