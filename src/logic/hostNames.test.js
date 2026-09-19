import { describe, it, expect } from 'vitest';
import { localizedHostNames, hostLabel } from './hostNames.js';

const resources = {
  en: { translation: { party: { defaultHost: 'Host' } } },
  de: { translation: { party: { defaultHost: 'Host' } } },
  fr: { translation: { party: { defaultHost: 'Hôte' } } },
  ja: { translation: { party: { defaultHost: 'ホスト' } } },
  xx: { translation: { party: {} } },
};

describe('hostNames', () => {
  it('collects every translated default host name except the English one', () => {
    expect([...localizedHostNames(resources)].sort()).toEqual(['Hôte', 'ホスト']);
    expect(localizedHostNames(undefined).size).toBe(0);
    expect(localizedHostNames({ fr: { party: { defaultHost: 'Hôte' } } }).has('Hôte')).toBe(true); // resources without the translation wrapper
  });

  it('tags such a name and leaves every other name alone', () => {
    const names = localizedHostNames(resources);
    expect(hostLabel('Hôte', names)).toBe('Hôte (host)');
    expect(hostLabel('ホスト', names, 'Host')).toBe('ホスト (Host)');
    expect(hostLabel('Host', names)).toBe('Host');
    expect(hostLabel('Zoë', names)).toBe('Zoë');
    expect(hostLabel(null, names)).toBe(null);
  });
});
