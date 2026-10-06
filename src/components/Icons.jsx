import React from "react";

/**
 * Shared feature icons so the same glyph marks a feature everywhere:
 * song card badges, entry page filter pills, the in-song duet toggle and
 * the volume controls. All draw with `currentColor`, so wrap them in an
 * element that sets the text colour.
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

/** Music note — the instrumental track. */
export const NoteIcon = ({ size = 14, strokeWidth = 2, className }) => (
  <svg width={size} height={size} strokeWidth={strokeWidth} className={className} aria-hidden="true" {...base}>
    <path d="M9 18V5l12-3v13" />
    <circle cx="6" cy="18" r="3" />
    <circle cx="18" cy="15" r="3" />
  </svg>
);

/** Microphone — the vocal track. */
export const MicIcon = ({ size = 14, strokeWidth = 2, className }) => (
  <svg width={size} height={size} strokeWidth={strokeWidth} className={className} aria-hidden="true" {...base}>
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <line x1="12" y1="19" x2="12" y2="23" />
  </svg>
);

/** Microphone, crossed out — vocals muted. */
export const MicOffIcon = ({ size = 14, strokeWidth = 2, className }) => (
  <svg width={size} height={size} strokeWidth={strokeWidth} className={className} aria-hidden="true" {...base}>
    <line x1="1" y1="1" x2="23" y2="23" />
    <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
    <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
    <line x1="12" y1="19" x2="12" y2="23" />
  </svg>
);

/** Speaker whose waves follow `level` (0–100); crossed out at 0. */
export const SpeakerIcon = ({ level = 100, size = 14, strokeWidth = 2, className }) => (
  <svg width={size} height={size} strokeWidth={strokeWidth} className={className} aria-hidden="true" {...base}>
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
    {level <= 0 ? (
      <>
        <line x1="23" y1="9" x2="17" y2="15" />
        <line x1="17" y1="9" x2="23" y2="15" />
      </>
    ) : (
      <>
        <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
        {level > 50 && <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />}
      </>
    )}
  </svg>
);

/** Music note + microphone — songs with separated karaoke/vocal stems. */
export const StemsIcon = ({ size = 14, strokeWidth = 2, className }) => (
  <span className={`inline-flex items-center gap-0.5 ${className ?? ""}`} aria-hidden="true">
    <NoteIcon size={size} strokeWidth={strokeWidth} />
    <MicIcon size={size} strokeWidth={strokeWidth} />
  </span>
);

/** Box with an arrow leaving it — open in a window of its own. */
export const PopOutIcon = ({ size = 14, strokeWidth = 2, className }) => (
  <svg width={size} height={size} strokeWidth={strokeWidth} className={className} aria-hidden="true" {...base}>
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" y1="14" x2="21" y2="3" />
  </svg>
);

/** Box with an arrow coming into it — back into the main window. */
export const PopInIcon = ({ size = 14, strokeWidth = 2, className }) => (
  <svg width={size} height={size} strokeWidth={strokeWidth} className={className} aria-hidden="true" {...base}>
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="10 8 10 14 16 14" />
    <line x1="21" y1="3" x2="10" y2="14" />
  </svg>
);

/** Padlock — stats kept private (profile, friends list, privacy setting). */
export const LockIcon = ({ size = 14, strokeWidth = 2, className }) => (
  <svg width={size} height={size} strokeWidth={strokeWidth} className={className} aria-hidden="true" {...base}>
    <rect x="4" y="11" width="16" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
);

/** Globe — stats everyone can see (privacy setting). */
export const GlobeIcon = ({ size = 14, strokeWidth = 2, className }) => (
  <svg width={size} height={size} strokeWidth={strokeWidth} className={className} aria-hidden="true" {...base}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18" />
    <path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18z" />
  </svg>
);
