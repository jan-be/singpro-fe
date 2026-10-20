import React from 'react';
import { MAX_STARS } from '../logic/scoreScale';

/**
 * ★★☆ for a number of earned stars. `size` is the font size in px.
 * Earned stars glow gold; the rest are faint outlines, so a 0-star score still
 * shows what could have been earned.
 */
const StarRating = ({ stars = 0, size = 16, className = '', label }) => (
  <span className={`inline-flex items-center gap-px leading-none ${className}`} style={{ fontSize: size }} aria-label={label ?? `${stars}/${MAX_STARS}`} role="img">
    {Array.from({ length: MAX_STARS }, (_, i) => (
      <span
        key={i}
        aria-hidden="true"
        className={i < stars ? 'text-yellow-400 drop-shadow-[0_0_6px_rgba(250,204,21,0.7)]' : 'text-white/20'}
      >
        ★
      </span>
    ))}
  </span>
);

export default StarRating;
