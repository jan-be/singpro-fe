/**
 * Score scale, mirrored from the backend (singpro-be/src/scoring.js): every
 * song scales to the same maximum, stars mark fixed fractions of it.
 */
export const MAX_SCORE = 10000;
export const STAR_THRESHOLDS = [3000, 6000, 9000];
export const MAX_STARS = STAR_THRESHOLDS.length;

/** Number of stars a score earns. */
export function starsFor(score) {
  let stars = 0;
  for (const t of STAR_THRESHOLDS) if (score >= t) stars++;
  return stars;
}

/** Points still missing for the next star, or 0 with all stars earned. */
export function toNextStar(score) {
  const next = STAR_THRESHOLDS.find(t => score < t);
  return next === undefined ? 0 : next - score;
}

/**
 * How far a play stopped before the song's end got (scores.completion, 0–1)
 * as the language writes a percentage: "62%", "62 %", "%62". Rounded down,
 * so a partial play (below 90 %, the backend's FINISHED_SHARE) never reads 90.
 */
export function completionText(share, lang) {
  const options = { style: 'percent', maximumFractionDigits: 0 };
  const value = Math.floor(share * 100 + 1e-6) / 100; // 0.58 * 100 is 57.999…
  try { return new Intl.NumberFormat(lang, options).format(value); } catch { return new Intl.NumberFormat('en', options).format(value); }
}
