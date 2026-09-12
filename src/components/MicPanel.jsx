import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MicIcon, MicOffIcon } from './Icons';
import PingIndicator from './PingIndicator';
import { PLAYER_COLOR_PALETTE, hueToCss } from '../logic/playerColor';
import { markPopoverClosed } from '../logic/popoverGuard';

/**
 * Microphone panel (top right): join / leave singing, input device, a live
 * input level, your colour and your latency. Replaces the old "join singing"
 * button and the colour dot in the scoreboard.
 *
 * Device names are only known once microphone access was granted; the list
 * is refreshed when the panel opens and when devices change.
 */
const MicPanel = ({
  micActive, onJoin, onLeave, statsRef,
  deviceId, onDeviceChange,
  ownColor, onColorChange, latencyMs,
}) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
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

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(p => !p)}
        title={micActive ? t('mic.on') : t('mic.off')}
        aria-expanded={open}
        className={`p-1.5 rounded border transition-colors cursor-pointer backdrop-blur-sm ${
          micActive
            ? 'border-neon-green/60 text-neon-green bg-neon-green/15 hover:bg-neon-green/25'
            : 'border-surface-lighter text-gray-300 bg-surface-light/70 hover:text-white hover:border-gray-500'
        }`}
      >
        {micActive ? <MicIcon size={16} /> : <MicOffIcon size={16} />}
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-2 w-72 bg-surface-light/95 backdrop-blur-sm border border-surface-lighter rounded-lg p-3 shadow-xl z-50 space-y-3 text-sm">
          <div className="text-xs text-gray-400 uppercase tracking-wider">{t('mic.title')}</div>

          <button
            type="button"
            onClick={micActive ? onLeave : onJoin}
            className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border transition-all font-semibold cursor-pointer ${
              micActive
                ? 'bg-red-500/15 text-red-400 border-red-500/40 hover:bg-red-500/25'
                : 'bg-neon-green/15 text-neon-green border-neon-green/40 hover:bg-neon-green/25'
            }`}
          >
            {micActive ? <><span className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />{t('party.leaveSinging')}</> : <><MicIcon size={16} />{t('party.joinSinging')}</>}
          </button>

          <label className="block">
            <span className="text-xs text-gray-400">{t('mic.device')}</span>
            <select
              value={deviceId ?? ''}
              onChange={e => onDeviceChange(e.target.value || null)}
              className="mt-1 w-full px-2 py-1.5 rounded bg-surface border border-surface-lighter text-white text-xs focus:outline-none focus:border-neon-cyan"
            >
              <option value="">{t('mic.defaultDevice')}</option>
              {devices.map(d => (
                <option key={d.deviceId} value={d.deviceId}>{d.label || t('mic.unnamedDevice')}</option>
              ))}
            </select>
          </label>

          <div>
            <div className="flex items-center justify-between text-xs text-gray-400">
              <span>{t('mic.level')}</span>
              {latencyMs != null && <span className="flex items-center gap-1"><PingIndicator latencyMs={latencyMs} size={10} />{Math.round(latencyMs)} ms</span>}
            </div>
            <div className="mt-1 h-2 rounded bg-white/10 overflow-hidden">
              <div className="h-full rounded bg-gradient-to-r from-neon-green via-neon-cyan to-neon-purple transition-[width] duration-75" style={{ width: `${micActive ? levelPct : 0}%` }} />
            </div>
          </div>

          <div>
            <div className="text-xs text-gray-400 mb-1.5">{t('party.yourColor')}</div>
            <div className="flex flex-wrap gap-1.5">
              {PLAYER_COLOR_PALETTE.map(h => (
                <button
                  key={h}
                  type="button"
                  onClick={() => onColorChange(h)}
                  className={`w-5 h-5 rounded-full border-2 transition-transform cursor-pointer ${
                    ownColor === h ? 'border-white scale-125' : 'border-transparent hover:scale-110'
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
