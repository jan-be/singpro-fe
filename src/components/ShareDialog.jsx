import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { shareSent } from "../logic/shareLinks";

/**
 * A share made after a wait (the share video, made by the server; a song's
 * card drawn on the profile): shown here, then shared to the phone's share
 * sheet or downloaded. A share sheet only opens shortly after a tap, so
 * whatever took seconds to make is shared from here with one more. On the
 * party page it lives outside the score screen, so the next song starting
 * does not take it away.
 *
 * share: { url, file, data, link? } (data: what navigator.share gets; the file a
 * video/mp4 or an image; link: the song link with the share's code, counted
 * as sent once shared or downloaded, logic/shareLinks.js), { error: true }, or null.
 */
const ShareDialog = ({ share, onClose }) => {
  const { t } = useTranslation();
  useEffect(() => () => { if (share?.url) URL.revokeObjectURL(share.url); }, [share]);
  if (!share) return null;

  const isVideo = !share.file || share.file.type.startsWith("video/");
  const canShare = share.file && navigator.share && navigator.canShare?.({ files: [share.file] });
  const shareLabel = isVideo ? t('share.shareVideo') : t('share.shareScore');
  const doShare = async () => {
    try {
      await navigator.share(share.data);
      shareSent(share.link);
    } catch (e) {
      if (e.name !== "AbortError") console.error("Sharing failed:", e);
    }
  };
  const download = () => {
    const link = document.createElement("a");
    link.download = share.file.name;
    link.href = share.url;
    link.click();
    shareSent(share.link);
  };

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={shareLabel} data-share-dialog="" className="fixed inset-0 z-[100] bg-[rgba(16,12,36,0.9)] flex flex-col items-center justify-center gap-4 p-4" onClick={onClose}>
      {share.error ? (
        <p role="alert" className="max-w-xs text-center text-sm text-white/80" onClick={e => e.stopPropagation()}>{t('share.videoFailed')}</p>
      ) : isVideo ? (
        <video src={share.url} controls autoPlay playsInline className="max-h-[70vh] max-w-full rounded-2xl shadow-2xl bg-black" onClick={e => e.stopPropagation()} />
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
          <button onClick={e => { e.stopPropagation(); download(); }} className={canShare ? "btn btn-ghost" : "btn btn-primary"}>
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
