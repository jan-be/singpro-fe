import { describe, it, expect } from 'vitest';
import { canSilenceByVolume, isAppleMobile, mediaVolumeSettable, silencePlayer, silenceCheck } from './youtubeSilence';

const used = { userActivation: { hasBeenActive: true } };
const fresh = { userActivation: { hasBeenActive: false } };
// A document whose media elements take a volume, and one like iOS's, where it always reads 1
const docWith = (settable: boolean) => ({
  createElement: () => {
    let v = 1;
    return { get volume() { return v; }, set volume(x) { if (settable) v = x; } };
  },
});
const desktop = docWith(true);
const ios = docWith(false);

const fakePlayer = () => {
  const calls: string[] = [];
  return { calls, setVolume: (v: number) => calls.push(`setVolume(${v})`), unMute: () => calls.push('unMute'), mute: () => calls.push('mute') };
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

  it('is false on an iPhone or iPad even where its media elements take a volume (iOS 27: YouTube played over the stems)', () => {
    const iPhone = { ...used, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1', maxTouchPoints: 5 };
    const iPadAsMac = { ...used, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Safari/605.1.15', maxTouchPoints: 5 };
    const chromeOnIPhone = { ...used, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0 Mobile/15E148 Safari/604.1' };
    const mac = { ...used, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Safari/605.1.15', maxTouchPoints: 0 };
    const android = { ...used, userAgent: 'Mozilla/5.0 (Linux; Android 16; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36', maxTouchPoints: 5 };
    for (const nav of [iPhone, iPadAsMac, chromeOnIPhone]) {
      expect(isAppleMobile(nav)).toBe(true);
      expect(canSilenceByVolume(nav, desktop)).toBe(false);
    }
    expect(isAppleMobile({ platform: 'iPhone' })).toBe(true);
    for (const nav of [mac, android]) {
      expect(isAppleMobile(nav)).toBe(false);
      expect(canSilenceByVolume(nav, desktop)).toBe(true);
    }
    const p = fakePlayer();
    expect(silencePlayer(p, iPhone, desktop)).toBe('muted');
    expect(p.calls).toEqual(['mute']);
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
