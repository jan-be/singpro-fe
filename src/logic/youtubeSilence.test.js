import { describe, it, expect } from 'vitest';
import { canSilenceByVolume, mediaVolumeSettable, silencePlayer, silenceCheck } from './youtubeSilence';

const used = { userActivation: { hasBeenActive: true } };
const fresh = { userActivation: { hasBeenActive: false } };
// A document whose media elements take a volume, and one like iOS's, where it always reads 1
const docWith = (settable) => ({
  createElement: () => {
    let v = 1;
    return { get volume() { return v; }, set volume(x) { if (settable) v = x; } };
  },
});
const desktop = docWith(true);
const ios = docWith(false);

const fakePlayer = () => {
  const calls = [];
  return { calls, setVolume: (v) => calls.push(`setVolume(${v})`), unMute: () => calls.push('unMute'), mute: () => calls.push('mute') };
};

describe('canSilenceByVolume', () => {
  it('only once the page has been used', () => {
    expect(canSilenceByVolume(used, desktop)).toBe(true);
    expect(canSilenceByVolume(fresh, desktop)).toBe(false);
  });

  it('is false where the browser does not say', () => {
    expect(canSilenceByVolume({}, desktop)).toBe(false);
    expect(canSilenceByVolume(undefined, desktop)).toBe(false);
  });

  it('is false where a page cannot set a volume (iOS: unmuted would be heard)', () => {
    expect(mediaVolumeSettable(desktop)).toBe(true);
    expect(mediaVolumeSettable(ios)).toBe(false);
    expect(canSilenceByVolume(used, ios)).toBe(false);
    expect(mediaVolumeSettable({ createElement: () => { throw new Error('no DOM'); } })).toBe(false);
  });
});

describe('silencePlayer', () => {
  it('turns the volume down before unmuting, and to 0 after (YouTube unmutes a player at 0 to 5)', () => {
    const p = fakePlayer();
    expect(silencePlayer(p, used, desktop)).toBe('volume');
    expect(p.calls).toEqual(['setVolume(1)', 'unMute', 'setVolume(0)']);
  });

  it('mutes on a page not used yet (unmuting would pause the video), and on iOS', () => {
    const p = fakePlayer();
    expect(silencePlayer(p, fresh, desktop)).toBe('muted');
    expect(silencePlayer(p, used, ios)).toBe('muted');
    expect(p.calls).toEqual(['mute', 'mute']);
  });
});

describe('silenceCheck', () => {
  it('muted or at volume 0 is silent', () => {
    expect(silenceCheck({ muted: true, volume: 80, canUseVolume: false })).toBe('silent');
    expect(silenceCheck({ muted: false, volume: 0, canUseVolume: true })).toBe('silent');
    expect(silenceCheck({ muted: false, volume: 0, canUseVolume: false })).toBe('silent');
  });

  it('moves a muted player to volume 0 once the page has been used', () => {
    expect(silenceCheck({ muted: true, volume: 80, canUseVolume: true })).toBe('upgrade');
    expect(silenceCheck({ muted: true, volume: 0, canUseVolume: true })).toBe('upgrade');
  });

  it('unmuted at a level is audible', () => {
    expect(silenceCheck({ muted: false, volume: 35, canUseVolume: true })).toBe('audible');
  });

  it('says nothing while the player knows nothing yet', () => {
    expect(silenceCheck({ muted: undefined, volume: undefined, canUseVolume: true })).toBeNull();
    expect(silenceCheck({ muted: false, volume: undefined, canUseVolume: true })).toBeNull();
  });
});
