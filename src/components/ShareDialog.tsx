import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { shareSent } from "../logic/shareLinks";
import { thrownField } from "../logic/authApi";

/** What ShareDialog shows: a share made after a wait, or `error` when it could not be made (see below) */
export type DialogShare =
  | { url: string; file: File; data: ShareData; link?: string; error?: undefined; kind?: undefined }
  | { error: true; kind?: string; url?: undefined; file?: undefined; data?: undefined; link?: undefined };

export interface ShareDialogProps {
  share: DialogShare | null;
  onClose: () => void;
}

/**
 * A share made after a wait (the share video, made by the server; a song's
 * card drawn on the profile): shown here, then shared to the phone's share
 * sheet or downloaded. A share sheet only opens shortly after a tap, so
 * whatever took seconds to make is shared from here with one more. On the
 * party page it lives outside the score screen, so the next song starting
 * does not take it away.
 *
 * share: { url, file, data, link? } (data: what navigator.share gets; the file a
 * video/mp4, an audio file or an image; link: the song link with the share's
 * code, counted as sent once shared or downloaded, logic/shareLinks.ts),
 * { error: true, kind } (kind: 'audio' when a recording could not be had,
 * else a video), or null.
 */
const ShareDialog = ({ share, onClose }: ShareDialogProps) => {
  const { t } = useTranslation();
  useEffect(() => () => { if (share?.url) URL.revokeObjectURL(share.url); }, [share]);
  if (!share) return null;

  const kind = share.file ? share.file.type.split("/")[0] : share.kind === "audio" ? "audio" : "video";
  const canShare = share.file && typeof navigator.share === "function" && navigator.canShare?.({ files: [share.file] }); // share is missing in some browsers
  const shareLabel = kind === "video" ? t('share.shareVideo') : kind === "audio" ? t('share.shareAudio') : t('share.shareImage');
  const doShare = async () => {
    try {
      await navigator.share(share.data);
      shareSent(share.link);
    } catch (e) {
      if (thrownField(e, "name") !== "AbortError") console.error("Sharing failed:", e);
    }
  };
  const download = (made: { file: File; url: string; link?: string }) => {
    const link = document.createElement("a");
    link.download = made.file.name;
    link.href = made.url;
    link.click();
    shareSent(made.link);
  };

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={shareLabel} data-share-dialog="" className="fixed inset-0 z-[100] bg-[rgba(16,12,36,0.9)] flex flex-col items-center justify-center gap-4 p-4" onClick={onClose}>
      {share.error ? (
        <p role="alert" className="max-w-xs text-center text-sm text-white/80" onClick={e => e.stopPropagation()}>{kind === "audio" ? t('share.audioFailed') : t('share.videoFailed')}</p>
      ) : kind === "video" ? (
        <video src={share.url} controls autoPlay playsInline className="max-h-[70vh] max-w-full rounded-2xl shadow-2xl bg-black" onClick={e => e.stopPropagation()} />
      ) : kind === "audio" ? (
        <div className="pop w-full max-w-sm p-4 flex flex-col gap-3" onClick={e => e.stopPropagation()}>
          <div className="text-sm font-medium text-white truncate">{share.data?.title}</div>
          <audio src={share.url} controls autoPlay className="w-full" />
        </div>
      ) : (
        <img src={share.url} alt="" className="max-h-[70vh] max-w-full rounded-2xl shadow-2xl" onClick={e => e.stopPropagation()} />
      )}
      <div className="flex flex-wrap justify-center gap-3">
        {canShare && (
          <button onClick={e => { e.stopPropagation(); doShare(); }} className="btn btn-primary">
            {shareLabel}
          </button>
        )}
        {share.file && (
          <button onClick={e => { e.stopPropagation(); download(share); }} className={canShare ? "btn btn-ghost" : "btn btn-primary"}>
            {t('share.download')}
          </button>
        )}
        <button onClick={onClose} className="btn btn-ghost">
          {t('share.close')}
        </button>
      </div>
    </div>,
    document.body,
  );
};

export default ShareDialog;
