import { describe, it, expect } from 'vitest';
import { readPlatformHints } from './platformHints';

const nav = (values: { platform?: string; platformVersion?: string; [hint: string]: unknown }) => ({
  userAgentData: { getHighEntropyValues: async () => values },
});
/** A browser that refuses to say */
const refusing = () => ({
  userAgentData: { getHighEntropyValues: async () => { throw new Error('NotAllowedError'); } },
});

describe('readPlatformHints', () => {
  it("passes on the system's name and version, nothing else", async () => {
    expect(await readPlatformHints(nav({ platform: 'Android', platformVersion: '15.0.0', model: 'Pixel 8', mobile: true })))
      .toEqual({ name: 'Android', version: '15.0.0' });
  });
  it('is null where the browser does not tell (Safari, Firefox) or refuses', async () => {
    expect(await readPlatformHints({})).toBeNull();
    expect(await readPlatformHints(undefined)).toBeNull();
    expect(await readPlatformHints(nav({ platform: 'Windows', platformVersion: '' }))).toBeNull();
    expect(await readPlatformHints(refusing())).toBeNull();
  });
});
