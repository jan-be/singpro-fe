import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MicIcon, MicOffIcon } from './Icons';
import PingIndicator from './PingIndicator';
import { PLAYER_COLOR_PALETTE, hueToCss } from '../logic/playerColor';
import { markPopoverClosed } from '../logic/popoverGuard';
import { useStoreValue } from '../logic/valueStore';
import { MAX_EXTRA_MICS, NAME_MAX, nameProblem, newExtraMic } from '../logic/extraSingers';

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
/** level 0..~0.3 → bar width % (the same curve as the main meter) */
const levelPct = (level) => Math.min(100, Math.round(Math.sqrt(Math.min(1, (level ?? 0) / 0.25)) * 100));

const Meter = ({ pct }) => (
  <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
    <div className="h-full rounded-full bg-gradient-to-r from-neon-green to-neon-cyan transition-[width] duration-75" style={{ width: `${pct}%` }} />
  </div>
);

/** Both channels of an input as it comes, or one of a stereo input's */
const ChannelSelect = ({ value, onChange, t }) => (
  <select
    value={value == null ? '' : String(value)}
    onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))}
    style={{ colorScheme: 'dark' }}
    className="field !w-auto shrink-0 h-9 px-2 text-sm cursor-pointer"
    aria-label={t('mic.channel')}
  >
    <option value="">{t('mic.channelBoth')}</option>
    <option value="0">{t('mic.channelLeft')}</option>
    <option value="1">{t('mic.channelRight')}</option>
  </select>
);

/** One extra microphone: its name (kept when the field is left), input, channel, level and state */
const ExtraMicRow = ({ slot, state, level, devices, slots, taken, onChange, onRemove, t }) => {
  const [name, setName] = useState(slot.name);
  useEffect(() => { setName(slot.name); }, [slot.name]);
  const problem = nameProblem(name, slot.id, slots, taken);
  const commit = () => { if (!problem && name.trim() !== slot.name) onChange({ ...slot, name: name.trim() }); };
  const error = state?.error === 'taken' ? t('mic.nameTaken') : state?.error ? t(`mic.error.${state.error}`) : null;
  const mono = slot.channel != null && state?.stats?.channels === 1;
  return (
    <div className="rounded-xl bg-white/[0.04] ring-1 ring-white/10 p-2.5 space-y-2">
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className="w-3 h-3 rounded-full shrink-0" style={{ background: slot.color != null ? hueToCss(slot.color) : 'rgba(255,255,255,0.3)' }} />
        <input
          value={name}
          maxLength={NAME_MAX}
          onChange={e => setName(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
          aria-label={t('mic.name')}
          aria-invalid={!!problem}
          className="field h-9 px-2.5 text-sm flex-1 min-w-0"
        />
        <button type="button" onClick={onRemove} title={t('mic.remove')} aria-label={t('mic.remove')} className="btn-icon w-8 h-8 shrink-0">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      </div>
      {problem && <p role="alert" className="text-xs text-red-400">{problem === 'taken' ? t('mic.nameTaken') : t('mic.nameEmpty')}</p>}
      <div className="flex gap-2">
        <select
          value={slot.deviceId ?? ''}
          onChange={e => onChange({ ...slot, deviceId: e.target.value || null })}
          style={{ colorScheme: 'dark' }}
          className="field h-9 px-2 text-sm cursor-pointer flex-1 min-w-0"
          aria-label={t('mic.device')}
        >
          <option value="">{t('mic.defaultDevice')}</option>
          {devices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || t('mic.unnamedDevice')}</option>)}
        </select>
        <ChannelSelect value={slot.channel} onChange={channel => onChange({ ...slot, channel })} t={t} />
      </div>
      <Meter pct={state?.phase === 'on' ? levelPct(level) : 0} />
      {state?.phase === 'starting' && <p className="text-xs text-neon-cyan">{t('mic.starting')}</p>}
      {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
      {mono && <p className="text-xs text-amber-300/90">{t('mic.monoInput')}</p>}
    </div>
  );
};

const MicPanel = ({
  micActive, micPhase = null, micError = null, onJoin, onLeave, statsRef,
  deviceId, onDeviceChange, multiMic,
  ownColor, onColorChange, latency, onOpenChange,
}) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  // The page keeps the microphone open while the panel shows its level (micStandby.js)
  useEffect(() => { onOpenChange?.(open); }, [open, onOpenChange]);
  const [devices, setDevices] = useState([]);
  const [level, setLevel] = useState(0);
  const [extraLevels, setExtraLevels] = useState({});
  const [moreOpen, setMoreOpen] = useState(() => (multiMic?.slots?.length ?? 0) > 0);
  const ref = useRef(null);
  const extraStatesRef = useRef(multiMic?.states);
  extraStatesRef.current = multiMic?.states;

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
    const id = setInterval(() => {
      setLevel(statsRef?.current?.lastVolume ?? 0);
      // the other microphones' levels, from their singers' pipelines
      const levels = {};
      for (const [slotId, st] of Object.entries(extraStatesRef.current ?? {})) levels[slotId] = st?.stats?.lastVolume ?? 0;
      setExtraLevels(levels);
    }, 80);
    return () => clearInterval(id);
  }, [open, micActive, statsRef]);
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
        <div className="pop fixed inset-x-3 top-[4.25rem] sm:absolute sm:inset-x-auto sm:top-full sm:right-0 sm:mt-2.5 sm:w-[19rem] max-h-[calc(100dvh-5.5rem)] overflow-y-auto p-4 z-50 space-y-4 text-sm">
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
            <div className="mt-2"><Meter pct={micActive ? levelPct(level) : 0} /></div>
          </div>

          {multiMic && (
            // Advanced: more microphones on this device, each its own singer
            <div className="border-t border-white/10 pt-3">
              <button
                type="button"
                onClick={() => setMoreOpen(o => !o)}
                aria-expanded={moreOpen}
                className="w-full flex items-center justify-between text-xs text-white/70 hover:text-white cursor-pointer"
              >
                <span>{t('mic.more')}{multiMic.slots.length > 0 && <span className="ml-1.5 text-white/45">({multiMic.slots.length})</span>}</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"
                  className={`transition-transform ${moreOpen ? 'rotate-180' : ''}`}><path d="m6 9 6 6 6-6" /></svg>
              </button>
              {moreOpen && (
                <div className="mt-3 space-y-3">
                  <p className="text-xs text-white/50 leading-relaxed">{t('mic.moreHint')}</p>
                  <label className="flex items-center justify-between gap-3">
                    <span className="text-xs text-white/55">{t('mic.thisChannel')}</span>
                    <ChannelSelect value={multiMic.channel} onChange={multiMic.onChannelChange} t={t} />
                  </label>
                  {micActive && multiMic.channel != null && statsRef?.current?.channels === 1 && (
                    <p className="text-xs text-amber-300/90 -mt-1">{t('mic.monoInput')}</p>
                  )}
                  {multiMic.slots.map(slot => (
                    <ExtraMicRow
                      key={slot.id}
                      slot={slot}
                      state={multiMic.states[slot.id]}
                      level={extraLevels[slot.id]}
                      devices={devices}
                      slots={multiMic.slots}
                      taken={multiMic.taken}
                      onChange={next => multiMic.onSlotsChange(multiMic.slots.map(s => (s.id === slot.id ? next : s)))}
                      onRemove={() => multiMic.onSlotsChange(multiMic.slots.filter(s => s.id !== slot.id))}
                      t={t}
                    />
                  ))}
                  {multiMic.slots.length < MAX_EXTRA_MICS && (
                    <button
                      type="button"
                      onClick={() => multiMic.onSlotsChange([...multiMic.slots, newExtraMic(multiMic.slots, {
                        label: n => t('mic.extraName', { n }), taken: multiMic.taken, palette: PLAYER_COLOR_PALETTE, usedColors: [ownColor],
                      })])}
                      className="btn btn-ghost btn-sm w-full"
                    >
                      <MicIcon size={15} />{t('mic.add')}
                    </button>
                  )}
                  {multiMic.slots.length > 0 && !micActive && <p className="text-xs text-white/45">{t('mic.followsYours')}</p>}
                </div>
              )}
            </div>
          )}

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
