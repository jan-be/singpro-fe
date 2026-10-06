/**
 * What a profile shows (pages/ProfilePage.jsx, backend GET /users/:username).
 *
 * Most of what people do at a party leaves no score: the screen that hosts,
 * a phone that only watches, a song left after a verse. So besides the saved
 * scores the profile has the songs played at parties (stats.played, with the
 * latest in playedRecently), and it is one of three pages:
 *   'scores'  the score numbers and best songs, with the songs played next to them
 *   'played'  played but nothing scored yet: those songs, and how scores come about
 *   'empty'   nothing yet: one message instead of a row of zeros
 * An older backend sends no played songs; its saved scores are what was played.
 */
export function profileView(stats) {
  const played = stats.played ?? stats.plays ?? 0;
  return { kind: stats.songsSung > 0 ? 'scores' : played > 0 ? 'played' : 'empty', played };
}

/**
 * Time on the mic in the reader's language: minutes under an hour, then hours
 * to a tenth (never rounded up to the next one); null under a minute.
 */
export function sungTime(seconds, lang) {
  if (!(seconds >= 60)) return null;
  const inHours = seconds >= 3600;
  const value = inHours ? Math.floor(seconds / 360) / 10 : Math.round(seconds / 60);
  try {
    return new Intl.NumberFormat(lang, { style: 'unit', unit: inHours ? 'hour' : 'minute', unitDisplay: 'short', maximumFractionDigits: 1 }).format(value);
  } catch {
    return `${value} ${inHours ? 'h' : 'min'}`;
  }
}
