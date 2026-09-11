import React from "react";

/**
 * Shared feature icons so the same glyph marks a feature everywhere:
 * song card badges, entry page filter pills, and the in-song duet toggle.
 * Both draw with `currentColor`, so wrap them in an element that sets the text colour.
 */

const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

/** Two-people icon — duet songs. */
export const DuetIcon = ({ size = 14, strokeWidth = 2, className }) => (
  <svg width={size} height={size} strokeWidth={strokeWidth} className={className} aria-hidden="true" {...base}>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

/** Music note + microphone — songs with separated karaoke/vocal stems. */
export const StemsIcon = ({ size = 14, strokeWidth = 2, className }) => (
  <span className={`inline-flex items-center gap-0.5 ${className ?? ""}`} aria-hidden="true">
    <svg width={size} height={size} strokeWidth={strokeWidth} {...base}>
      <path d="M9 18V5l12-3v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="15" r="3" />
    </svg>
    <svg width={size} height={size} strokeWidth={strokeWidth} {...base}>
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
    </svg>
  </span>
);
