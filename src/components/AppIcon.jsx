import React, { useId, useMemo } from "react";
import raw from "../icon.svg?raw";

/**
 * The app icon (src/icon.svg, the same drawing as public/icon.svg) drawn
 * inline: the logo in the bars, on the home page and on the share card.
 *
 * Inline rather than an <img>, because the share card is turned into a
 * picture by html-to-image, which only draws inline SVG reliably (see
 * ShareCardImage). The icon's gradients and patterns are referenced by id,
 * and ids are global to the page, so every copy gets its own: otherwise all
 * copies draw with the first copy's definitions, and draw nothing once that
 * copy is hidden (display: none).
 */
const INNER = raw.slice(raw.indexOf(">", raw.indexOf("<svg")) + 1, raw.lastIndexOf("</svg>"));

/** The markup with every id, and every reference to one, suffixed. */
export function withIdSuffix(markup, suffix) {
  return markup
    .replace(/\bid="([^"]+)"/g, `id="$1-${suffix}"`)
    .replace(/url\(#([^)]+)\)/g, `url(#$1-${suffix})`)
    .replace(/href="#([^"]+)"/g, `href="#$1-${suffix}"`);
}

export default function AppIcon({ width = 24, height = 24, style, className }) {
  const suffix = useId().replace(/[^A-Za-z0-9_-]/g, "");
  const html = useMemo(() => withIdSuffix(INNER, suffix), [suffix]);
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 512 512"
      width={width}
      height={height}
      style={style}
      className={className}
      aria-hidden="true"
      focusable="false"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
