import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { markPopoverClosed } from '../logic/popoverGuard';
import { footage } from '../logic/cameraClip';
import type { MicErrorKind } from '../logic/MicrophoneInput';

/** Why the camera cannot film now, though it is on: no microphone, or recordings not saved */
export type CameraBlock = 'mic' | 'recordings' | null;

export interface CameraButtonProps {
  /** the singer turned it on (it films while a song plays) */
  on: boolean;
  /** it is open now */
  live: boolean;
  opening: boolean;
  error: MicErrorKind | null;
  /** null while it is being found out */
  supported: boolean | null;
  blocked: CameraBlock;
  onChange: (on: boolean) => void;
  /** its panel opened or closed */
  onOpenChange?: (open: boolean) => void;
}

const CameraIcon = ({ off = false }: { off?: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="2" y="6" width="14" height="12" rx="2.5" /><path d="M16 10.5 22 7v10l-6-3.5" />
    {off && <line x1="3" y1="3" x2="21" y2="21" />}
  </svg>
);

/**
 * Influencer mode's camera button (next to the microphone's), and its panel:
 * what the camera is for and what happens to the footage, the switch, and
 * deleting the footage this tab keeps (logic/cameraClip.ts). While it films,
 * the button glows red and the stage shows the camera (CameraPreview).
 */
const CameraButton = ({ on, live, opening, error, supported, blocked, onChange, onOpenChange }: CameraButtonProps) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  useEffect(() => { onOpenChange?.(open); }, [open, onOpenChange]);
  const [armed, setArmed] = useState(false); // "Delete footage" waits for a second click
  const ref = useRef<HTMLDivElement>(null);
  const kept = useSyncExternalStore(footage.subscribe, () => footage.count());

  useEffect(() => {
    if (!open) return;
    const handler = (e: PointerEvent) => { if (ref.current && !(e.target instanceof Node && ref.current.contains(e.target))) { setOpen(false); markPopoverClosed(); } };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [open]);
  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(id);
  }, [armed]);

  const state = live ? t('camera.live') : on ? t('camera.waiting') : t('camera.off');
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(p => !p)}
        title={`${t('camera.title')}: ${state}`}
        aria-label={`${t('camera.title')}: ${state}`}
        aria-expanded={open}
        aria-busy={opening}
        data-camera-button={live ? 'live' : on ? 'on' : 'off'}
        className={`btn-icon ${live ? 'bg-red-500/20 text-red-300 hover:bg-red-500/30 hover:text-red-200' : on ? 'text-hot' : ''}`}
      >
        <CameraIcon off={!on} />
        {live && <span aria-hidden="true" className="absolute top-1 right-1 w-2 h-2 rounded-full bg-red-500 ring-2 ring-[#1e183e] animate-pulse" />}
        {error && !live && <span aria-hidden="true" className="absolute top-1 right-1 w-2 h-2 rounded-full bg-red-500 ring-2 ring-[#1e183e]" />}
      </button>

      {open && (
        <div className="pop fixed inset-x-3 top-[4.25rem] sm:absolute sm:inset-x-auto sm:top-full sm:right-0 sm:mt-2.5 sm:w-[19rem] max-h-[calc(100dvh-5.5rem)] overflow-y-auto p-4 z-50 space-y-3 text-sm" data-camera-panel="">
          <div className="flex items-center justify-between gap-3">
            <div className="pop-label">{t('camera.title')}</div>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-white/40">{t('settings.experimental')}</span>
          </div>
          <p className="text-xs text-white/65 leading-snug">{t('camera.explain')}</p>

          {supported === false ? (
            <p role="alert" className="text-xs text-red-300">{t('camera.unsupported')}</p>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3">
                <span id="camera-switch" className="text-sm font-semibold text-white">{t('camera.film')}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  aria-labelledby="camera-switch"
                  disabled={supported === null}
                  data-camera-switch=""
                  onClick={() => onChange(!on)}
                  className="switch flex-shrink-0"
                />
              </div>
              <p className="text-xs text-white/50 -mt-1" aria-live="polite">
                {live ? <span className="text-red-300 font-semibold">● {t('camera.live')}</span> : on ? t('camera.waitingHint') : null}
              </p>
              {on && blocked && <p className="text-xs text-amber-200">{t(blocked === 'mic' ? 'camera.needsMic' : 'camera.needsRecordings')}</p>}
              {error && <p role="alert" className="text-xs text-red-300">{t(`camera.error.${error}`)}</p>}
            </>
          )}

          <div className="pt-3 border-t border-white/10 flex items-center justify-between gap-3">
            <span className="text-xs text-white/55">{kept ? t('camera.kept', { count: kept }) : t('camera.noneKept')}</span>
            {kept > 0 && (
              <button
                type="button"
                onClick={() => { if (armed) { setArmed(false); footage.clear(); } else setArmed(true); }}
                aria-pressed={armed}
                data-camera-delete=""
                className={`btn btn-sm ${armed ? 'btn-stop animate-pulse' : 'btn-ghost hover:text-red-300'}`}
              >
                {armed ? t('camera.deleteConfirm') : t('camera.delete')}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * The camera on the stage while it is open: the singer sees themself
 * (mirrored, as in a mirror) and that it is on. `film`: the camera
 * (logic/cameraClip.ts createCameraFilm): its canvas, the picture that is
 * filmed, is shown; its video element is on the page out of sight (it gives
 * the frames). ✕ turns the camera off.
 */
export const CameraPreview = ({ film, onOff }: { film: { video: HTMLVideoElement; canvas: HTMLCanvasElement }; onOff: () => void }) => {
  const { t } = useTranslation();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const { video, canvas } = film;
    video.className = 'absolute inset-0 w-full h-full object-cover -scale-x-100 invisible'; // (out of sight, unless the camera shows it: logic/cameraClip.ts)
    canvas.className = 'absolute inset-0 w-full h-full';
    el.prepend(video, canvas);
    video.play().catch(() => {});
    return () => { video.remove(); canvas.remove(); };
  }, [film]);
  return (
    <div ref={box} data-camera-preview="" className="fixed left-3 top-[4.5rem] z-30 w-[128px] h-[72px] sm:w-[176px] sm:h-[99px] rounded-2xl overflow-hidden bg-black ring-2 ring-red-500/80 shadow-[0_10px_30px_-10px_rgba(0,0,0,0.9)]">
      <span className="absolute left-1.5 top-1.5 z-10 inline-flex items-center gap-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] font-bold text-white">
        <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />REC
      </span>
      <button type="button" onClick={onOff} aria-label={t('camera.turnOff')} title={t('camera.turnOff')}
        className="absolute right-1 top-1 z-10 w-6 h-6 rounded-full bg-black/60 text-white/90 grid place-items-center hover:bg-black/80 cursor-pointer">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
      </button>
    </div>
  );
};

export default CameraButton;
