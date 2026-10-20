import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { appDomain } from "../GlobalConsts";
import { isGoodSong, shareLinkFor, shareSent } from "../logic/shareLinks";
import { playerHue } from "../logic/playerColor";
import { cardNames, leaderboardRows, loadSongArt, melodyOf, rankByScore } from "../logic/shareImage";
import { makeShareVideo } from "../logic/takes";
import { useShareCardDrawer } from "./useShareCardDrawer";

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
 *
 * "Share video", when this page kept the singer's take of the song (`take`:
 * the upload's answer, "Save recordings" on): the same card as the picture
 * of a short video whose sound is the best moment of the take over the
 * song's backing track, made by the server (routes/takes.js). It takes a few
 * seconds, so it always opens in a preview to watch and share from there:
 * `onVideo` hands it to the party page (ShareDialog), where the next
 * song starting does not close it.
 *
 * The song link on the card (its text and QR code) carries the share's code
 * (logic/shareLinks.js), which says who brought whoever opens it: one for
 * the card and one for the video of this play (`play`: { partyId, songId,
 * startedAt }), asked for with the art. After a good song (three stars or
 * more, or a previous best beaten) the button stands out and says so.
 */
const ShareCard = ({ songInfo, scores, currentUserName, songId, playerColors, take = null, onVideo, play = null }) => {
  const { t, i18n } = useTranslation();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false); // a second tap before the re-render is ignored too
  const [preview, setPreview] = useState(null); // { url, data } when the share needs one more tap
  const [videoBusy, setVideoBusy] = useState(false);
  const [takeReady, setTakeReady] = useState(null); // { recordingId, token } once this song's take is uploaded
  const prepared = useRef(null);
  const drawer = useShareCardDrawer();

  const ranked = useMemo(() => rankByScore(scores), [scores]);
  const me = ranked.find(p => p.username === currentUserName);
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
    // the links' codes are asked for while the art loads
    linkRef.current('card');
    if (takeReadyRef.current) linkRef.current('video');
    return prepared.current;
  }, [songInfo, part]);

  // The song link with this share's code: the card's, or the video's (of the take)
  const linkOf = (kind) => shareLinkFor({
    kind, songId,
    partyId: play?.partyId ?? null,
    playStartedAt: play?.songId === songId ? play.startedAt ?? null : null,
    nickname: currentUserName,
    ...(kind === 'video' && takeReady ? { recordingId: takeReady.recordingId } : {}),
  });
  const linkRef = useRef(linkOf);
  linkRef.current = linkOf;
  const takeReadyRef = useRef(takeReady);
  takeReadyRef.current = takeReady;

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);

  // The song's take, once its upload answered: the video can be made from it
  useEffect(() => {
    let active = true;
    setTakeReady(null);
    Promise.resolve(take?.promise).then(r => { if (active && r?.recordingId && r?.token) setTakeReady({ recordingId: r.recordingId, token: r.token }); }, () => {});
    return () => { active = false; };
  }, [take]);

  const names = cardNames(songInfo, i18n.language);
  const fileName = `singspree-${(songInfo?.title ?? "score").replace(/\W+/g, "-")}.jpg`;

  const download = (blob) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.download = fileName;
    link.href = url;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };

  /** The card, drawn with `songUrl` on it: a JPEG Blob (the share image), or with `video` the share video's pictures (useShareCardDrawer.drawVideo) */
  const drawCard = async (songUrl, { video = false } = {}) => {
    const [art, melody] = await prepare();
    const { rows, more } = leaderboardRows(ranked, me.username);
    return drawer[video ? "drawVideo" : "draw"](
      { names, me, ranked, rows, more, hueOf, melody, art: art && { aspect: art.aspect }, songUrl, t },
      { art, hue: hueOf(me.username) },
    );
  };
  const shareTexts = (songUrl) => {
    const score = me.score.toLocaleString();
    return {
      title: t('share.shareTitle', { score, title: names.title ?? appDomain }),
      text: t('share.shareText', { title: names.title, artist: names.artist, score, url: songUrl }),
    };
  };

  const handleShare = async () => {
    if (busyRef.current || !me) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const link = await linkOf('card');
      const blob = await drawCard(link);
      const file = new File([blob], fileName, { type: "image/jpeg" });
      const data = { ...shareTexts(link), files: [file] };
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share(data);
          shareSent(link);
          return;
        } catch (e) {
          if (e.name === "AbortError") return; // the sheet was closed
          // The tap's permission ran out while the image was drawn: share from a preview
          if (e.name === "NotAllowedError") {
            setPreview({ url: URL.createObjectURL(blob), data, link });
            return;
          }
        }
      }
      download(blob);
      shareSent(link);
    } catch (e) {
      console.error("Share card generation failed:", e);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  // The share video: the card drawn here, the sound made on the server from the take
  // the video made, kept for the take: asked again, it opens at once
  const madeVideo = useRef(null);
  const handleShareVideo = async () => {
    if (busyRef.current || !me || !takeReady) return;
    busyRef.current = true;
    setVideoBusy(true);
    try {
      let made = madeVideo.current?.recordingId === takeReady.recordingId ? madeVideo.current : null;
      if (!made) {
        const link = await linkOf('video');
        const pictures = await drawCard(link, { video: true });
        made = { recordingId: takeReady.recordingId, link, blob: await makeShareVideo({ ...takeReady, ...pictures }) };
        madeVideo.current = made;
      }
      const { blob, link } = made;
      const file = new File([blob], fileName.replace(/\.jpg$/, ".mp4"), { type: "video/mp4" });
      onVideo?.({ url: URL.createObjectURL(blob), file, data: { ...shareTexts(link), files: [file] }, link });
    } catch (e) {
      console.error("Making the share video failed:", e);
      onVideo?.({ error: true });
    } finally {
      busyRef.current = false;
      setVideoBusy(false);
    }
  };

  const shareFromPreview = async () => {
    try {
      await navigator.share(preview.data);
      shareSent(preview.link);
      setPreview(null);
    } catch (e) {
      if (e.name !== "AbortError") console.error("Sharing the score image failed:", e);
    }
  };

  if (!me) return null;
  const good = isGoodSong(me); // the share is offered louder

  return (
    <>
      <span className="relative inline-flex">
      {good && (
        <span aria-hidden="true" data-good-song=""
          className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 whitespace-nowrap rounded-full bg-white text-[#0b0a1a] text-xs font-semibold px-3 py-1 shadow-lg animate-slide-up">
          {t('share.goodSong')}
        </span>
      )}
      <button
        onClick={handleShare}
        onPointerEnter={prepare}
        onPointerDown={prepare}
        onFocus={prepare}
        disabled={busy}
        aria-busy={busy}
        aria-description={good ? t('share.goodSong') : undefined}
        className={`btn ${good ? "btn-primary" : "btn-ghost"} ${busy ? "opacity-60" : ""}`}
      >
        <svg className={`w-4 h-4 ${busy ? "animate-pulse" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
          <polyline points="16 6 12 2 8 6" />
          <line x1="12" y1="2" x2="12" y2="15" />
        </svg>
        {t('share.shareScore')}
      </button>
      </span>

      {takeReady && onVideo && (
        <button
          onClick={handleShareVideo}
          onPointerEnter={prepare}
          onPointerDown={prepare}
          onFocus={prepare}
          disabled={busy || videoBusy}
          aria-busy={videoBusy}
          data-share-video=""
          className={`btn btn-ghost ${videoBusy ? "opacity-60" : ""}`}
        >
          <svg className={`w-4 h-4 ${videoBusy ? "animate-pulse" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="5" width="14" height="14" rx="2.5" />
            <path d="m17 10 4-2.5v9L17 14" />
          </svg>
          {videoBusy ? t('share.makingVideo') : t('share.shareVideo')}
        </button>
      )}

      {/* the card, off-screen while it is drawn */}
      {drawer.element}

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
