import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { SpeakerIcon, MicIcon, MicOffIcon } from './Icons';

/**
 * Volume popover for PartyBar.
 *
 *   volume       0–100  master volume — always what you hear (YouTube volume
 *                       without stems, both stem GainNodes with stems)
 *   vocalsLevel  0–100  how much of the original vocals is mixed in; only
 *                       shown when the song has separated stems
 *
 * Each row is a horizontal slider (vertical range inputs are unreliable on
 * WebKit) with the icon+label acting as a one-tap mute toggle that restores
 * the previous level when tapped again.
 *
 * volumeTooltip: nudge shown when the user tried the YouTube iframe's own
 *   volume while stems are active (that player is muted on purpose).
 * stemsHint / onDismissStemsHint: one-time callout explaining the Vocals
 *   slider on the first song with stems; dismissed by its button or by
 *   opening the control.
 */
const VolumeControl = ({
  volume, vocalsLevel, onVolumeChange, onVocalsLevelChange, hasStems, volumeTooltip,
  stemsHint = false, onDismissStemsHint,
}) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const lastVolumeRef = useRef(volume > 0 ? volume : 100);
  const lastVocalsRef = useRef(vocalsLevel > 0 ? vocalsLevel : 100);

  useEffect(() => { if (volume > 0) lastVolumeRef.current = volume; }, [volume]);
  useEffect(() => { if (vocalsLevel > 0) lastVocalsRef.current = vocalsLevel; }, [vocalsLevel]);

  // Auto-open when the nudge fires so the user sees where the controls are
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

  const toggleMute = () => onVolumeChange(volume > 0 ? 0 : lastVolumeRef.current);
  const toggleVocals = () => onVocalsLevelChange(vocalsLevel > 0 ? 0 : lastVocalsRef.current);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => {
          if (stemsHint) onDismissStemsHint?.();
          setOpen(p => !p);
        }}
        title={t('volume.title')}
        aria-expanded={open}
        className={`p-1.5 rounded border transition-colors cursor-pointer ${
          hasStems
            ? 'border-neon-purple/40 text-neon-purple hover:bg-neon-purple/10 hover:border-neon-purple'
            : 'border-surface-lighter text-gray-400 hover:text-gray-300 hover:border-gray-500'
        }`}
      >
        <SpeakerIcon size={16} level={volume} />
      </button>

      {/* First-time callout: this song has a separate vocal track */}
      {stemsHint && hasStems && !open && (
        <div
          role="note"
          className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-64 bg-surface-light/95 backdrop-blur-sm border border-neon-purple/50 rounded-lg p-3 shadow-lg z-50 text-xs text-gray-200"
        >
          <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-3 h-3 rotate-45 bg-surface-light border-l border-t border-neon-purple/50" aria-hidden="true" />
          <div className="flex items-start gap-2">
            <MicIcon size={16} className="text-neon-purple flex-shrink-0 mt-0.5" />
            <p>{t('volume.stemsHint', { vocals: t('volume.vocals') })}</p>
          </div>
          <div className="mt-2 text-right">
            <button
              type="button"
              onClick={onDismissStemsHint}
              className="px-2.5 py-1 rounded border border-neon-purple/50 bg-neon-purple/15 text-neon-purple hover:bg-neon-purple/25 transition-colors cursor-pointer"
            >
              {t('volume.gotIt')}
            </button>
          </div>
        </div>
      )}

      {open && (
        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-60 bg-surface-light/95 backdrop-blur-sm border border-surface-lighter rounded-lg p-3 shadow-lg z-50 space-y-3">
          {volumeTooltip && hasStems && (
            <div className="text-xs text-neon-purple text-center animate-pulse">
              {t('volume.useTheseControls')}
            </div>
          )}

          <SliderRow
            icon={<SpeakerIcon size={16} level={volume} />}
            label={t('volume.title')}
            value={volume}
            onChange={onVolumeChange}
            onToggle={toggleMute}
            accent="accent-neon-cyan"
          />

          {hasStems && (
            <SliderRow
              icon={vocalsLevel > 0 ? <MicIcon size={16} /> : <MicOffIcon size={16} />}
              label={t('volume.vocals')}
              value={vocalsLevel}
              onChange={onVocalsLevelChange}
              onToggle={toggleVocals}
              accent="accent-neon-purple"
            />
          )}
        </div>
      )}
    </div>
  );
};

const SliderRow = ({ icon, label, value, onChange, onToggle, accent }) => (
  <div>
    <div className="flex items-center justify-between text-xs mb-1.5">
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={value === 0}
        title={label}
        className={`flex items-center gap-1.5 cursor-pointer transition-colors ${
          value > 0 ? 'text-gray-200 hover:text-white' : 'text-gray-500 hover:text-gray-300'
        }`}
      >
        {icon}
        <span>{label}</span>
      </button>
      <span className="text-gray-400 tabular-nums">{value}%</span>
    </div>
    <input
      type="range" min="0" max="100" step="1" value={value}
      onChange={e => onChange(Number(e.target.value))}
      aria-label={label}
      className={`w-full h-1.5 cursor-pointer ${accent}`}
    />
  </div>
);

export default VolumeControl;
