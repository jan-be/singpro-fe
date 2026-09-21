import { describe, it, expect } from 'vitest';
import { silentReason } from './silentPlayback';

const stems = (over = {}) => ({
  playing: true, hasStems: true, stem: { paused: false, failed: false, ended: false }, ctxState: 'running',
  iframeMuted: true, mutedByUs: false, volume: 100, ...over,
});
const iframe = (over = {}) => ({
  playing: true, hasStems: false, stem: null, ctxState: undefined,
  iframeMuted: false, mutedByUs: false, volume: 100, ...over,
});

describe('silentReason', () => {
  it('is quiet while nothing is playing', () => {
    expect(silentReason(stems({ playing: false, stem: { paused: true, failed: false } }))).toBeNull();
    expect(silentReason(iframe({ playing: false, iframeMuted: true }))).toBeNull();
  });

  describe('with stems', () => {
    it('hears running stems and a running context', () => {
      expect(silentReason(stems())).toBeNull();
    });
    it('needs a tap when the stem could not start (no gesture yet)', () => {
      expect(silentReason(stems({ stem: { paused: true, failed: false } }))).toBe('stems');
    });
    it('needs a tap when the AudioContext is not running', () => {
      expect(silentReason(stems({ ctxState: 'suspended' }))).toBe('stems');
      expect(silentReason(stems({ ctxState: 'interrupted' }))).toBe('stems');
    });
    it('does not nag about a stem that failed to load — no tap fixes that', () => {
      expect(silentReason(stems({ stem: { paused: true, failed: true } }))).toBeNull();
    });
    it('is fine with a stem that ended before the video did', () => {
      expect(silentReason(stems({ stem: { paused: true, failed: false, ended: true } }))).toBeNull();
    });
    it('waits for the stem elements to exist', () => {
      expect(silentReason(stems({ stem: null, ctxState: undefined }))).toBeNull();
    });
    it('ignores the iframe: it is muted on purpose', () => {
      expect(silentReason(stems({ iframeMuted: true }))).toBeNull();
    });
  });

  describe('without stems', () => {
    it('hears an unmuted iframe', () => {
      expect(silentReason(iframe())).toBeNull();
    });
    it('needs a tap when YouTube muted itself', () => {
      expect(silentReason(iframe({ iframeMuted: true }))).toBe('iframe');
    });
    it('leaves the joiner start alone: the page muted it and offers the tap already', () => {
      expect(silentReason(iframe({ iframeMuted: true, mutedByUs: true }))).toBeNull();
    });
    it('respects a volume of zero', () => {
      expect(silentReason(iframe({ iframeMuted: true, volume: 0 }))).toBeNull();
    });
  });
});
