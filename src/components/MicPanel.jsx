import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MicIcon, MicOffIcon } from './Icons';
import PingIndicator from './PingIndicator';
import { PLAYER_COLOR_PALETTE, hueToCss } from '../logic/playerColor';
import { markPopoverClosed } from '../logic/popoverGuard';
import { useStoreValue } from '../logic/valueStore';

/**
 * Microphone panel (top right): join / leave singing, input device, a live
 * input level, your colour and your latency. Replaces the old "join singing"
 * button and the colour dot in the scoreboard.
 *
 * Device names are only known once microphone access was granted; the list
 * is refreshed when the panel opens and when devices change.
 *
 * Joining takes a moment (the first time several seconds, see initMicInput):
 * while micPhase is set the mic button spins, closed panel or not, and the
 * join button says what is happening and cannot be pressed twice. micError
 * says why the last attempt failed (and puts a red dot on the mic button).
 */

const Spinner = () => (
  <span aria-hidden="true" className="block w-4 h-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
);
// Your latency comes in a store (valueStore.js), measured every few seconds:
// only the open panel shows it, so only this line re-renders for it, not the
// party page around it
const Latency = ({ store }) => {
  const latencyMs = useStoreValue(store);
  if (latencyMs == null) return null;
  return <span className="flex items-center gap-1"><PingIndicator latencyMs={latencyMs} size={10} />{Math.round(latencyMs)} ms</span>;
};
const MicPanel = ({
  micActive, micPhase = null, micError = null, onJoin, onLeave, statsRef,
  deviceId, onDeviceChange,
  ownColor, onColorChange, latency, onOpenChange,
}) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  // The page keeps the microphone open while the panel shows its level (micStandby.js)
  useEffect(() => { onOpenChange?.(open); }, [open, onOpenChange]);
  const [devices, setDevices] = useState([]);
  const [level, setLevel] = useState(0);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = e => { if (ref.current && !ref.current.contains(e.target)) { setOpen(false); markPopoverClosed(); } };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [open]);

  useEffect(() => {
    if (!open || !navigator.mediaDevices?.enumerateDevices) return;
    const refresh = () => navigator.mediaDevices.enumerateDevices()
      .then(list => setDevices(list.filter(d => d.kind === 'audioinput')))
      .catch(() => {});
    refresh();
    navigator.mediaDevices.addEventListener?.('devicechange', refresh);
    return () => navigator.mediaDevices.removeEventListener?.('devicechange', refresh);
  }, [open, micActive]);

  // Live input level while the panel is open (RMS from the mic pipeline, ~0..0.3 in practice)
  useEffect(() => {
    if (!open || !micActive) { setLevel(0); return; }
    const id = setInterval(() => setLevel(statsRef?.current?.lastVolume ?? 0), 80);
    return () => clearInterval(id);
  }, [open, micActive, statsRef]);
  const levelPct = Math.min(100, Math.round(Math.sqrt(Math.min(1, level / 0.25)) * 100));
  const starting = micPhase != null;
  const phaseText = micPhase === 'loading' ? t('mic.loading') : t('mic.starting');

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(p => !p)}
        title={starting ? phaseText : micActive ? t('mic.on') : t('mic.off')}
        aria-expanded={open}
        aria-busy={starting}
        className={`btn-icon ${
          starting
            ? 'text-neon-cyan'
            : micActive
              ? 'bg-neon-green/15 text-neon-green hover:bg-neon-green/25 hover:text-neon-green'
              : ''
        }`}
      >
        {starting ? <Spinner /> : micActive ? <MicIcon size={18} strokeWidth={1.8} /> : <MicOffIcon size={18} strokeWidth={1.8} />}
        {micError && !starting && <span aria-hidden="true" className="absolute top-1 right-1 w-2 h-2 rounded-full bg-red-500 ring-2 ring-[#1e183e]" />}
      </button>

      {open && (
        // On phones the button sits near the middle of a narrow screen, so the
        // panel spans the width under the capsule instead of hanging off its edge
        <div className="pop fixed inset-x-3 top-[4.25rem] sm:absolute sm:inset-x-auto sm:top-full sm:right-0 sm:mt-2.5 sm:w-[19rem] p-4 z-50 space-y-4 text-sm">
          <div className="pop-label">{t('mic.title')}</div>

          <button
            type="button"
            onClick={micActive ? onLeave : onJoin}
            disabled={starting}
            aria-busy={starting}
            className={`btn w-full ${
              starting
                ? 'btn-ghost text-neon-cyan cursor-wait'
                : micActive
                  ? 'btn-stop'
                  : 'btn-go'
            }`}
          >
            {starting
              ? <><Spinner />{phaseText}</>
              : micActive
                ? <><span className="w-2 h-2 rounded-full bg-current animate-pulse" />{t('party.leaveSinging')}</>
                : <><MicIcon size={17} />{t('party.joinSinging')}</>}
          </button>
          {micPhase === 'loading' && <p className="text-xs text-white/50 -mt-2">{t('mic.firstTime')}</p>}
          {micError && !starting && <p role="alert" className="text-xs text-red-400 -mt-2">{t(`mic.error.${micError}`)}</p>}

          <label className="block">
            <span className="text-xs text-white/55">{t('mic.device')}</span>
            <select
              value={deviceId ?? ''}
              onChange={e => onDeviceChange(e.target.value || null)}
              style={{ colorScheme: 'dark' }}
              className="field mt-1.5 h-10 px-3 text-sm cursor-pointer"
            >
              <option value="">{t('mic.defaultDevice')}</option>
              {devices.map(d => (
                <option key={d.deviceId} value={d.deviceId}>{d.label || t('mic.unnamedDevice')}</option>
              ))}
            </select>
          </label>

          <div>
            <div className="flex items-center justify-between text-xs text-white/55">
              <span>{t('mic.level')}</span>
              {latency && <Latency store={latency} />}
            </div>
            <div className="mt-2 h-1.5 rounded-full bg-white/10 overflow-hidden">
              <div className="h-full rounded-full bg-gradient-to-r from-neon-green to-neon-cyan transition-[width] duration-75" style={{ width: `${micActive ? levelPct : 0}%` }} />
            </div>
          </div>

          <div>
            <div className="text-xs text-white/55 mb-2.5">{t('party.yourColor')}</div>
            <div className="flex flex-wrap gap-2.5">
              {PLAYER_COLOR_PALETTE.map(h => (
                <button
                  key={h}
                  type="button"
                  onClick={() => onColorChange(h)}
                  aria-pressed={ownColor === h}
                  className={`w-6 h-6 rounded-full transition-transform cursor-pointer ${
                    ownColor === h ? 'ring-2 ring-white ring-offset-2 ring-offset-[#251e48]' : 'hover:scale-110'
                  }`}
                  style={{ background: hueToCss(h) }}
                  title={t('party.yourColor')}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MicPanel;
