import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { appDomain } from "../GlobalConsts";
import { playerHue } from "../logic/playerColor";
import { cardNames, layoutCard, leaderboardRows, loadSongArt, melodyOf, rankByScore, renderShareImage } from "../logic/shareImage";
import ShareCardImage from "./ShareCardImage";

/**
 * ShareCard — the "Share Score" button of the score screen, and the image it
 * shares: a story-sized poster of your score on the song (ShareCardImage,
 * drawn by logic/shareImage.js).
 *
 * Nothing is drawn until the button is used: the card is only put in the page
 * for the moment it takes to draw it. The song's art and melody start loading
 * at the first sign of a share (pointer over, focus, touch), so the tap has
 * less to wait for. The image goes to the share sheet where the browser can
 * share files (phones, some desktops), else it is downloaded. A share sheet only opens shortly after a
 * tap; when drawing took longer than the browser allows, the image is shown
 * with a button to share it from there.
 */
const ShareCard = ({ songInfo, scores, currentUserName, songId, playerColors }) => {
  const { t, i18n } = useTranslation();
  const [drawing, setDrawing] = useState(null); // the card's extra props while the image is drawn
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false); // a second tap before the re-render is ignored too
  const [preview, setPreview] = useState(null); // { url, data } when the share needs one more tap
  const cardRef = useRef(null);
  const cardReady = useRef(null); // resolves with the card once it is in the page
  const prepared = useRef(null);

  const ranked = useMemo(() => rankByScore(scores), [scores]);
  const me = ranked.find(p => p.username === currentUserName);
  const songUrl = songId ? `https://${appDomain}/sing/${songId}` : `https://${appDomain}`;
  const hueOf = useCallback(name => playerHue(playerColors, name), [playerColors]);

  // Art and melody belong to the song: a new song loads them afresh
  useEffect(() => () => {
    prepared.current?.then(([art]) => art?.dispose());
    prepared.current = null;
  }, [songInfo]);

  const part = me?.part ?? 1;
  const prepare = useCallback(() => {
    if (!prepared.current) {
      prepared.current = Promise.all([
        loadSongArt(songInfo?.videoId).catch(() => null),
        melodyOf(songInfo?.lyrics, part).catch(() => null),
      ]);
    }
    return prepared.current;
  }, [songInfo, part]);

  // The card is in the page: hand it to the drawing
  useLayoutEffect(() => {
    if (drawing && cardRef.current && cardReady.current) {
      cardReady.current(cardRef.current);
      cardReady.current = null;
    }
  }, [drawing]);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);

  const names = cardNames(songInfo, i18n.language);
  const fileName = `singpro-${(songInfo?.title ?? "score").replace(/\W+/g, "-")}.jpg`;

  const download = (blob) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.download = fileName;
    link.href = url;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };

  const handleShare = async () => {
    if (busyRef.current || !me) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const [art, melody] = await prepare();
      const card = await new Promise(resolve => {
        cardReady.current = resolve;
        setDrawing({ art: art && { aspect: art.aspect }, melody });
      });
      layoutCard(card);
      const blob = await renderShareImage(card, { art, hue: hueOf(me.username) });
      setDrawing(null);

      const score = me.score.toLocaleString();
      const file = new File([blob], fileName, { type: "image/jpeg" });
      const data = {
        title: t('share.shareTitle', { score, title: names.title ?? appDomain }),
        text: t('share.shareText', { title: names.title, artist: names.artist, score, url: songUrl }),
        files: [file],
      };
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share(data);
          return;
        } catch (e) {
          if (e.name === "AbortError") return; // the sheet was closed
          // The tap's permission ran out while the image was drawn: share from a preview
          if (e.name === "NotAllowedError") {
            setPreview({ url: URL.createObjectURL(blob), data });
            return;
          }
        }
      }
      download(blob);
    } catch (e) {
      console.error("Share card generation failed:", e);
    } finally {
      setDrawing(null);
      busyRef.current = false;
      setBusy(false);
    }
  };

  const shareFromPreview = async () => {
    try {
      await navigator.share(preview.data);
      setPreview(null);
    } catch (e) {
      if (e.name !== "AbortError") console.error("Sharing the score image failed:", e);
    }
  };

  if (!me) return null;

  const { rows, more } = leaderboardRows(ranked, me.username);

  return (
    <>
      <button
        onClick={handleShare}
        onPointerEnter={prepare}
        onPointerDown={prepare}
        onFocus={prepare}
        disabled={busy}
        aria-busy={busy}
        className={`btn btn-ghost ${busy ? "opacity-60 cursor-wait" : ""}`}
      >
        <svg className={`w-4 h-4 ${busy ? "animate-pulse" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
          <polyline points="16 6 12 2 8 6" />
          <line x1="12" y1="2" x2="12" y2="15" />
        </svg>
        {t('share.shareScore')}
      </button>

      {/* Off-screen while it is drawn; in the body, away from the score
          screen's scrolling and blur */}
      {drawing && createPortal(
        <ShareCardImage
          ref={cardRef}
          names={names}
          me={me}
          ranked={ranked}
          rows={rows}
          more={more}
          hueOf={hueOf}
          melody={drawing.melody}
          art={drawing.art}
          songUrl={songUrl}
          t={t}
        />,
        document.body,
      )}

      {preview && createPortal(
        <div role="dialog" aria-modal="true" aria-label={t('share.shareScore')} className="fixed inset-0 z-[100] bg-[rgba(16,12,36,0.9)] flex flex-col items-center justify-center gap-4 p-4" onClick={() => setPreview(null)}>
          <img src={preview.url} alt="" className="max-h-[75vh] max-w-full rounded-2xl shadow-2xl" onClick={e => e.stopPropagation()} />
          <div className="flex gap-3">
            <button
              onClick={e => { e.stopPropagation(); shareFromPreview(); }}
              className="btn btn-primary"
            >
              {t('share.shareScore')}
            </button>
            <button onClick={() => setPreview(null)} className="btn btn-ghost">
              {t('share.close')}
            </button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
};

export default ShareCard;
