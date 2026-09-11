import { describe, it, expect } from 'vitest';
import { defaultHue, playerHue, PLAYER_COLOR_PALETTE } from './playerColor.js';

describe('playerColor', () => {
  it('derives the same default hue for the same name every time', () => {
    expect(defaultHue('Alice')).toBe(defaultHue('Alice'));
    expect(PLAYER_COLOR_PALETTE).toContain(defaultHue('Alice'));
    expect(PLAYER_COLOR_PALETTE).toContain(defaultHue(''));
  });

  it('prefers the colour the server knows over the default', () => {
    expect(playerHue({ Alice: 300 }, 'Alice')).toBe(300);
    expect(playerHue({ Alice: 0 }, 'Alice')).toBe(0); // hue 0 is a real colour, not "unknown"
    expect(playerHue({}, 'Bob')).toBe(defaultHue('Bob'));
    expect(playerHue(undefined, 'Bob')).toBe(defaultHue('Bob'));
  });
});
