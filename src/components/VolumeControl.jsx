import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Volume control popover for PartyBar.
 *
 * hasStems=true  (stems available):
 *   YouTube is fully muted. Two sliders control our stems:
 *     musicVolume  → instrumental GainNode
 *     vocalsVolume → lead vocals GainNode
 *
 * hasStems=false (no stems):
 *   Single slider controlling YouTube iframe volume.
 *   musicVolume is used as the unified volume value.
 *
 * volumeTooltip: when true, shows a hint that the user should use our
 *   controls instead of the YouTube iframe volume.
 */
const VolumeControl = ({ musicVolume, vocalsVolume, onMusicChange, onVocalsChange, hasStems, volumeTooltip }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Auto-open popover when tooltip fires (so the user sees the controls)
  useEffect(() => {
    if (volumeTooltip) setOpen(true);
  }, [volumeTooltip]);

  useEffect(() => {
    if (!open) return;
    const handler = e => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [open]);

  // Effective volume for the speaker icon
  const effectiveVol = musicVolume;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(p => !p)}
        title={t('volume.title')}
        className={`p-1.5 rounded border transition-colors cursor-pointer ${
          hasStems
            ? 'border-neon-purple/40 text-neon-purple hover:bg-neon-purple/10 hover:border-neon-purple'
            : 'border-surface-lighter text-gray-400 hover:text-gray-300 hover:border-gray-500'
        }`}
      >
        {hasStems ? (
          /* Mixer icon — hints at dual-stem independent control */
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" />
            <line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" />
            <line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" />
            <line x1="1" y1="14" x2="7" y2="14" />
            <line x1="9" y1="8" x2="15" y2="8" />
            <line x1="17" y1="16" x2="23" y2="16" />
          </svg>
        ) : (
          /* Standard speaker icon */
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            {effectiveVol > 0 && (
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
            )}
            {effectiveVol > 50 && (
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
            )}
          </svg>
        )}
      </button>

      {open && (
        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 bg-surface-light/95 backdrop-blur-sm border border-surface-lighter rounded-lg p-3 shadow-lg z-50">
          {/* Tooltip nudge when user tried to change volume via YouTube iframe */}
          {volumeTooltip && hasStems && (
            <div className="text-xs text-neon-purple mb-2 text-center max-w-36 animate-pulse">
              {t('volume.useTheseControls')}
            </div>
          )}

          {hasStems ? (
            /* ── Stems mode: dual sliders ── */
            <div className="flex gap-4">
              <div className="flex flex-col items-center gap-1.5">
                <input
                  type="range" min="0" max="100" value={musicVolume}
                  onChange={e => onMusicChange(Number(e.target.value))}
                  className="volume-slider accent-neon-purple"
                  style={{ writingMode: 'vertical-lr', direction: 'rtl', height: '100px' }}
                />
                <span className="text-xs text-neon-purple">{t('volume.music')}</span>
              </div>
              <div className="flex flex-col items-center gap-1.5">
                <input
                  type="range" min="0" max="100" value={vocalsVolume}
                  onChange={e => onVocalsChange(Number(e.target.value))}
                  className="volume-slider accent-neon-cyan"
                  style={{ writingMode: 'vertical-lr', direction: 'rtl', height: '100px' }}
                />
                <span className="text-xs text-neon-cyan">{t('volume.vocals')}</span>
              </div>
            </div>
          ) : (
            /* ── No stems: single volume slider synced with YouTube ── */
            <div className="flex flex-col items-center gap-1.5">
              <input
                type="range" min="0" max="100" value={musicVolume}
                onChange={e => {
                  const v = Number(e.target.value);
                  onMusicChange(v);
                  onVocalsChange(v);
                }}
                className="volume-slider accent-neon-cyan"
                style={{ writingMode: 'vertical-lr', direction: 'rtl', height: '100px' }}
              />
              <span className="text-xs text-gray-400">{t('volume.title')}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default VolumeControl;
