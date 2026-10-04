import React, { useId, useMemo } from "react";

/**
 * A component that draws an SVG file inline (imported with `?raw`).
 *
 * Inline rather than an <img>, because the share card is turned into a
 * picture by html-to-image, which only draws inline SVG reliably (see
 * ShareCardImage). The drawings reference their gradients and patterns by
 * id, and ids are global to the page, so every copy gets its own: otherwise
 * all copies draw with the first copy's definitions, and draw nothing once
 * that copy is hidden (display: none).
 *
 * Give it a height (or a width) and the other side follows the viewBox;
 * CSS classes can resize it further. With a `label` it is an image with that
 * name (for a logo that is a link's only content), otherwise decoration.
 */
export function withIdSuffix(markup, suffix) {
  return markup
    .replace(/\bid="([^"]+)"/g, `id="$1-${suffix}"`)
    .replace(/url\(#([^)]+)\)/g, `url(#$1-${suffix})`)
    .replace(/href="#([^"]+)"/g, `href="#$1-${suffix}"`);
}

export function createInlineSvg(raw, { label } = {}) {
  const open = raw.slice(raw.indexOf("<svg"), raw.indexOf(">", raw.indexOf("<svg")) + 1);
  const inner = raw.slice(raw.indexOf(">", raw.indexOf("<svg")) + 1, raw.lastIndexOf("</svg>"));
  const viewBox = open.match(/viewBox="([^"]+)"/)[1];
  const [, , vbW, vbH] = viewBox.split(/[\s,]+/).map(Number);
  const isNumber = v => typeof v === "number" || /^\d+(\.\d+)?$/.test(String(v));

  return function InlineSvg({ width, height, style, className }) {
    const suffix = useId().replace(/[^A-Za-z0-9_-]/g, "");
    const html = useMemo(() => withIdSuffix(inner, suffix), [suffix]);
    let w = width, h = height;
    if (h != null && w == null && isNumber(h)) w = Math.round((Number(h) * vbW) / vbH);
    if (w != null && h == null && isNumber(w)) h = Math.round((Number(w) * vbH) / vbW);
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox={viewBox}
        width={w}
        height={h}
        style={{ aspectRatio: `${vbW} / ${vbH}`, ...style }}
        className={className}
        focusable="false"
        {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": "true" })}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  };
}
