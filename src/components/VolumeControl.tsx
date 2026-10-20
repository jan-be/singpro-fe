import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { SpeakerIcon, MicIcon, MicOffIcon, NoteIcon } from './Icons';
import { markPopoverClosed } from '../logic/popoverGuard';

/**
 * Volume popover for PartyBar.
 *
 *   volume             0–100  master volume — always what you hear (YouTube
 *                             volume without stems, both stem GainNodes with stems)
 *   instrumentalLevel  0–100  how much of the instrumental is mixed in; stems only
 *   vocalsLevel        0–100  how much of the original vocals is mixed in; stems only
 *
 * Each row is a horizontal slider (vertical range inputs are unreliable on
 * WebKit) with the icon+label acting as a one-tap mute toggle that restores
 * the previous level when tapped again.
 *
 * restoreVolume: the level a mute toggle brings back when the control starts
 *   at 0 (a joiner whose sound is off by default); 100 without one.
 * volumeTooltip: nudge shown when the user tried the YouTube iframe's own
 *   volume while stems are active (that player is muted on purpose).
 * stemsHint / onDismissStemsHint: one-time callout explaining the Vocals
 *   slider on the first song with stems; dismissed by its button or by
 *   opening the control.
 */
const VolumeControl = ({
  volume, restoreVolume, vocalsLevel, instrumentalLevel = 100, onVolumeChange, onVocalsLevelChange, onInstrumentalLevelChange,
  hasStems, volumeTooltip, stemsHint = false, onDismissStemsHint,
}) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const lastVolumeRef = useRef(volume > 0 ? volume : restoreVolume > 0 ? restoreVolume : 100);
  const lastVocalsRef = useRef(vocalsLevel > 0 ? vocalsLevel : 100);
  const lastInstrumentalRef = useRef(instrumentalLevel > 0 ? instrumentalLevel : 100);

  useEffect(() => { if (volume > 0) lastVolumeRef.current = volume; }, [volume]);
  useEffect(() => { if (vocalsLevel > 0) lastVocalsRef.current = vocalsLevel; }, [vocalsLevel]);
  useEffect(() => { if (instrumentalLevel > 0) lastInstrumentalRef.current = instrumentalLevel; }, [instrumentalLevel]);

  // Auto-open when the nudge fires so the user sees where the controls are,
  // and close again with it unless they were used meanwhile: on a TV there is
  // no pointer to click it away with
  const nudgedRef = useRef(false);
  useEffect(() => {
    if (volumeTooltip) {
      setOpen(true);
      nudgedRef.current = true;
    } else if (nudgedRef.current) {
      nudgedRef.current = false;
      setOpen(false);
    }
  }, [volumeTooltip]);
  const used = () => { nudgedRef.current = false; };

  useEffect(() => {
    if (!open) return;
    const handler = e => {
      if (ref.current && !ref.current.contains(e.target)) { setOpen(false); markPopoverClosed(); }
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [open]);

  const toggleMute = () => onVolumeChange(volume > 0 ? 0 : lastVolumeRef.current);
  const toggleVocals = () => onVocalsLevelChange(vocalsLevel > 0 ? 0 : lastVocalsRef.current);
  const toggleInstrumental = () => onInstrumentalLevelChange?.(instrumentalLevel > 0 ? 0 : lastInstrumentalRef.current);

  return (
    <div className="relative" ref={ref} onPointerDown={used} onKeyDown={used}>
      <button
        onClick={() => {
          used();
          if (stemsHint) onDismissStemsHint?.();
          setOpen(p => !p);
        }}
        title={t('volume.title')}
        aria-expanded={open}
        className={`btn-icon ${hasStems ? 'text-neon-purple hover:text-neon-purple' : ''}`}
      >
        <SpeakerIcon size={18} strokeWidth={1.8} level={volume} />
      </button>

      {/* First-time callout: this song has a separate vocal track */}
      {stemsHint && hasStems && !open && (
        <div
          role="note"
          className="pop absolute top-full left-1/2 -translate-x-1/2 mt-2.5 w-72 p-4 z-50 text-sm"
        >
          <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-3 h-3 rotate-45 bg-[#251e48] border-l border-t border-white/[0.14]" aria-hidden="true" />
          <div className="flex items-start gap-3">
            <span className="grid place-items-center w-8 h-8 rounded-full bg-neon-purple/15 text-neon-purple flex-shrink-0">
              <MicIcon size={16} />
            </span>
            <p className="text-white/85 leading-snug">{t('volume.stemsHint', { vocals: t('volume.vocals') })}</p>
          </div>
          <div className="mt-3 flex justify-end">
            <button type="button" onClick={onDismissStemsHint} className="btn btn-sm btn-primary">
              {t('volume.gotIt')}
            </button>
          </div>
        </div>
      )}

      {open && (
        <div className="pop absolute top-full left-1/2 -translate-x-1/2 mt-2.5 w-64 p-4 z-50 space-y-4">
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
            accent="#ffffff"
          />

          {hasStems && (
            <>
              <SliderRow
                icon={<NoteIcon size={16} />}
                label={t('volume.instrumental')}
                value={instrumentalLevel}
                onChange={onInstrumentalLevelChange}
                onToggle={toggleInstrumental}
                accent="var(--color-neon-purple)"
              />
              <SliderRow
                icon={vocalsLevel > 0 ? <MicIcon size={16} /> : <MicOffIcon size={16} />}
                label={t('volume.vocals')}
                value={vocalsLevel}
                onChange={onVocalsLevelChange}
                onToggle={toggleVocals}
                accent="var(--color-neon-purple)"
              />
            </>
          )}
        </div>
      )}
    </div>
  );
};

const SliderRow = ({ icon, label, value, onChange, onToggle, accent }) => (
  <div>
    <div className="flex items-center justify-between text-xs mb-1">
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={value === 0}
        title={label}
        className={`flex items-center gap-2 cursor-pointer transition-colors ${
          value > 0 ? 'text-white/85 hover:text-white' : 'text-white/40 hover:text-white/70'
        }`}
      >
        {icon}
        <span className="font-medium">{label}</span>
      </button>
      <span className="text-white/45 tabular-nums">{value}%</span>
    </div>
    <input
      type="range" min="0" max="100" step="1" value={value}
      onChange={e => onChange(Number(e.target.value))}
      aria-label={label}
      className="range"
      style={{ '--v': `${value}%`, '--accent': accent }}
    />
  </div>
);

export default VolumeControl;
