import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { uploadAvatar, removeAvatar, isCancelled } from '../logic/authApi';
import { AVATAR_PX, MAX_ZOOM, clampOffset, cropRect, placement, rezoom, encodeAvatar } from '../logic/avatarImage';
import { errorMessage } from '../pages/AuthPage';

const VIEW = 256; // the crop square, CSS px (fits a 360 px phone inside the dialog)

/** Codes the upload can fail with that have words of their own; the rest are the sign-in errors' */
const AVATAR_ERRORS = ['too_large', 'not_image', 'bad_size', 'animated', 'unreadable'];
const avatarError = (t, e) => (AVATAR_ERRORS.includes(e?.code) ? t(`avatar.errors.${e.code}`) : errorMessage(t, e));

/** Open a picture the user picked: resolves to a loaded <img> (EXIF rotation applied by the browser). */
function openPicture(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve({ img, url });
    img.onerror = () => { URL.revokeObjectURL(url); reject(Object.assign(new Error('unreadable'), { code: 'unreadable' })); };
    img.src = url;
  });
}

/**
 * The crop dialog: the picture under a round window; drag (one finger or the
 * mouse) to move it, pinch, wheel or the slider to zoom. Save cuts out what
 * the circle shows at AVATAR_PX and uploads it.
 */
const CropDialog = ({ picture, onCancel, onSave, busy, error }) => {
  const { t } = useTranslation();
  const { img } = picture;
  const dims = { width: img.naturalWidth, height: img.naturalHeight, view: VIEW };
  const [pos, setPos] = useState({ zoom: 1, dx: 0, dy: 0 });
  const pointers = useRef(new Map()); // pointerId -> { x, y }
  const gesture = useRef(null); // what the pointers started from

  const startGesture = () => {
    const pts = [...pointers.current.values()];
    gesture.current = pts.length >= 2
      ? { pinch: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1, from: pos }
      : { x: pts[0]?.x ?? 0, y: pts[0]?.y ?? 0, from: pos };
  };
  const onPointerDown = (e) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    startGesture();
  };
  const onPointerMove = (e) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;
    const pts = [...pointers.current.values()];
    if (g.pinch && pts.length >= 2) {
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      setPos(rezoom({ ...dims, ...g.from }, g.from.zoom * (d / g.pinch)));
    } else if (!g.pinch) {
      setPos({ zoom: g.from.zoom, ...clampOffset({ ...dims, zoom: g.from.zoom, dx: g.from.dx + e.clientX - g.x, dy: g.from.dy + e.clientY - g.y }) });
    }
  };
  const onPointerUp = (e) => {
    pointers.current.delete(e.pointerId);
    startGesture(); // the finger left on the glass carries on dragging from here
  };

  // Wheel zoom: a non-passive listener, so the page does not scroll underneath
  const viewRef = useRef(null);
  const posRef = useRef(pos);
  posRef.current = pos;
  useEffect(() => {
    const el = viewRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      setPos(rezoom({ ...dims, ...posRef.current }, posRef.current.zoom * Math.exp(-e.deltaY * 0.0015)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [img]); // eslint-disable-line react-hooks/exhaustive-deps -- dims follow img

  // Escape closes, like the other dialogs
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  const { left, top, scale } = placement({ ...dims, ...pos });

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50" onClick={busy ? undefined : onCancel} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="avatar-crop-title"
        className="pop fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 p-5 w-[320px] max-w-[94vw]"
      >
        <div id="avatar-crop-title" className="text-white font-semibold tracking-[-0.01em] mb-1">{t('avatar.cropTitle')}</div>
        <div className="text-white/55 text-xs mb-3.5">{t('avatar.cropHint')}</div>

        <div
          ref={viewRef}
          data-testid="avatar-crop"
          className="relative mx-auto overflow-hidden rounded-2xl bg-black/30 cursor-grab active:cursor-grabbing touch-none select-none"
          style={{ width: VIEW, height: VIEW }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <img
            src={picture.url}
            alt=""
            draggable={false}
            className="absolute max-w-none pointer-events-none"
            style={{ left, top, width: dims.width * scale, height: dims.height * scale }}
          />
          {/* What stays: the circle; the corners are dimmed */}
          <div aria-hidden="true" className="absolute inset-0 rounded-full pointer-events-none" style={{ boxShadow: '0 0 0 9999px rgba(12, 8, 32, 0.72), 0 0 0 2px rgba(255, 255, 255, 0.75) inset' }} />
        </div>

        <label className="flex items-center gap-3 mt-4 text-white/70 text-xs">
          <span className="flex-shrink-0">{t('avatar.zoom')}</span>
          <input
            type="range"
            min={1}
            max={MAX_ZOOM}
            step={0.01}
            value={pos.zoom}
            onChange={(e) => setPos(rezoom({ ...dims, ...pos }, Number(e.target.value)))}
            className="flex-1 accent-hot"
          />
        </label>

        {error && <div className="mt-3 text-xs text-[#ff8a97]" role="alert">{error}</div>}

        <div className="flex justify-end gap-2 mt-4">
          <button type="button" onClick={onCancel} disabled={busy} className="btn btn-ghost btn-sm">{t('avatar.cancel')}</button>
          <button type="button" onClick={() => onSave(cropRect({ ...dims, ...pos }))} disabled={busy} className="btn btn-primary btn-sm">
            {busy ? t('avatar.saving') : t('avatar.save')}
          </button>
        </div>
      </div>
    </>
  );
};

/**
 * Choosing, cropping, saving and removing your profile picture. Returns
 * `choose` (opens the file picker: on a phone that offers the camera too),
 * `remove`, and `ui` (the hidden input and the dialog) to render once.
 * `onChange(path | null)` hears the new picture; `onMessage` / `onError`
 * a line for the page.
 */
export function useAvatarEditor({ onChange, onMessage, onError } = {}) {
  const { t } = useTranslation();
  const inputRef = useRef(null);
  const [picture, setPicture] = useState(null); // { img, url } being cropped
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const close = useCallback(() => { setPicture(null); setError(null); }, []);
  // The object URL of a picture no longer cropped (closed, saved, unmounted) is let go
  useEffect(() => () => { if (picture) URL.revokeObjectURL(picture.url); }, [picture]);

  const choose = useCallback(() => inputRef.current?.click(), []);

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // the same file again is a new choice
    if (!file) return;
    try {
      setError(null);
      setPicture(await openPicture(file));
    } catch (err) {
      onError?.(avatarError(t, err));
    }
  };

  const save = async (rect) => {
    setBusy(true);
    setError(null);
    try {
      const blob = await encodeAvatar(picture.img, rect, AVATAR_PX);
      const path = await uploadAvatar(blob);
      close();
      onChange?.(path);
      onMessage?.(t('avatar.saved'));
    } catch (err) {
      setError(avatarError(t, err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(t('avatar.removeConfirm'))) return;
    setBusy(true);
    try {
      await removeAvatar();
      onChange?.(null);
      onMessage?.(t('avatar.removed'));
    } catch (err) {
      if (!isCancelled(err)) onError?.(avatarError(t, err));
    } finally {
      setBusy(false);
    }
  };

  const ui = (
    <>
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={onFile} data-testid="avatar-file" />
      {picture && <CropDialog picture={picture} onCancel={close} onSave={save} busy={busy} error={error} />}
    </>
  );

  return { choose, remove, ui, busy };
}
