import React from 'react';
import { defaultHue, hueToCss } from '../logic/playerColor';

/** Round badge with the first letter of a username, coloured like the player's default hue. */
const Avatar = ({ username, size = 28, className = '' }) => (
  <span
    className={`inline-flex items-center justify-center rounded-full font-bold text-white select-none flex-shrink-0 ${className}`}
    style={{ width: size, height: size, fontSize: size * 0.5, background: hueToCss(defaultHue(username ?? '')), boxShadow: '0 0 0 1px rgba(255,255,255,0.15) inset' }}
    aria-hidden="true"
  >
    {(username ?? '?').slice(0, 1).toUpperCase()}
  </span>
);

export default Avatar;
