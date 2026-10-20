/**
 * Player colours. A player's hue comes from the server (chosen in the colour
 * picker, sent on join and on change). Until a client has heard it, every
 * client derives the same default from the username, so a singer never looks
 * different on two screens.
 */

/** Hues offered in the colour picker; also the pool for defaults. */
export const PLAYER_COLOR_PALETTE = [20, 45, 65, 140, 160, 215, 240, 335];

/** Deterministic default hue for a username — identical on every client. */
export const defaultHue = (username) => {
  const hash = String(username ?? '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return PLAYER_COLOR_PALETTE[hash % PLAYER_COLOR_PALETTE.length];
};

/** The hue to paint a player with: the known colour, else the shared default. */
export const playerHue = (colors, username) => colors?.[username] ?? defaultHue(username);

export const hueToCss = (hue, lightness = 55) => `hsl(${hue}, 100%, ${lightness}%)`;
