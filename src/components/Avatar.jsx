import React, { useState } from 'react';
import { defaultHue, hueToCss } from '../logic/playerColor';
import { avatarInitial, avatarSrc } from '../logic/avatar';

/**
 * A person, round: their profile picture, or without one (guests, accounts
 * that never set one, a picture that fails to load) the first letter of the
 * name on their colour. `src` is the server's picture path (logic/avatar.js);
 * `hue` the player's colour in a party, else the name's default. Decorative:
 * the name is always written next to it.
 */
const Avatar = ({ username, src = null, hue, size = 28, className = '' }) => {
  const url = avatarSrc(src);
  const [failed, setFailed] = useState(null); // the URL that did not load
  const picture = url && failed !== url;
  return (
    <span
      className={`relative inline-flex items-center justify-center rounded-full font-bold text-white select-none flex-shrink-0 overflow-hidden ${className}`}
      style={{ width: size, height: size, fontSize: size * 0.5, lineHeight: 1, background: hueToCss(hue ?? defaultHue(username ?? '')) }}
      aria-hidden="true"
    >
      {picture
        ? <img src={url} alt="" width={size} height={size} draggable={false} decoding="async" onError={() => setFailed(url)} className="w-full h-full object-cover" />
        : avatarInitial(username)}
      <span className="absolute inset-0 rounded-full pointer-events-none" style={{ boxShadow: '0 0 0 1px rgba(255,255,255,0.15) inset' }} />
    </span>
  );
};

export default Avatar;
