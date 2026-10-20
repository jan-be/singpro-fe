import { describe, it, expect } from 'vitest';
import { completionText, starsFor, toNextStar } from './scoreScale';

describe('scoreScale', () => {
  it('stars and the points to the next one', () => {
    expect([0, 1499, 1500, 2999, 3000, 4500, 7499, 7500, 10000].map(starsFor)).toEqual([0, 0, 1, 1, 2, 3, 4, 5, 5]);
    expect(toNextStar(5500)).toBe(500);
    expect(toNextStar(8000)).toBe(0);
  });

  it('a partial play\'s completion reads as the language writes a percentage, rounded down', () => {
    expect(completionText(0.62, 'en')).toBe('62%');
    expect(completionText(0.58, 'en')).toBe('58%');
    expect(completionText(0.899, 'en')).toBe('89%');
    expect(completionText(0.62, 'de')).toBe('62 %');
    expect(completionText(0.62, 'tr')).toBe('%62');
    expect(completionText(0.62, 'not a language!')).toBe('62%');
  });
});
