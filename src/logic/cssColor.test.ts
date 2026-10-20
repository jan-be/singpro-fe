import { describe, it, expect } from 'vitest';
import { premultiplied } from './cssColor';

const close = (a, b) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 3));

describe('premultiplied', () => {
  it('reads hex colours', () => {
    close(premultiplied('#b44aff'), [0xb4 / 255, 0x4a / 255, 1, 1]);
    close(premultiplied('#fff'), [1, 1, 1, 1]);
  });
  it('premultiplies rgba()', () => {
    close(premultiplied('rgba(255,255,255,0.12)'), [0.1216, 0.1216, 0.1216, 0.1216]);
    close(premultiplied('rgba(0, 0, 0, 0.45)'), [0, 0, 0, 0.451]);
  });
  it('converts hsl() and hsla() like the browser', () => {
    // hsl(335, 100%, 55%) is rgb(255, 25.5, 121.1) by the CSS formula
    close(premultiplied('hsl(335, 100%, 55%)'), [1, 26 / 255, 121 / 255, 1]);
    const c = premultiplied('hsla(140, 100%, 50%, 0.3)'); // rgb(0, 255, 85)
    close(c, [0, 0.302, (85 / 255) * 0.302, 0.302]);
  });
  it('is transparent for what it cannot read, and caches', () => {
    expect(premultiplied('nonsense')).toEqual([0, 0, 0, 0]);
    expect(premultiplied('#123456')).toBe(premultiplied('#123456'));
  });
});
