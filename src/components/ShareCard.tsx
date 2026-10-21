import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { appDomain } from "../GlobalConsts";
import { thrownField } from "../logic/authApi";
import { isGoodSong, shareLinkFor, shareSent } from "../logic/shareLinks";
import { playerHue } from "../logic/playerColor";
import { cardNames, leaderboardRows, loadSongArt, melodyOf, rankByScore } from "../logic/shareImage";
import { makeShareVideo } from "../logic/takes";
import { footage, segmentFile } from "../logic/cameraClip";
import { useShareCardDrawer, type ShareCardPaint } from "./useShareCardDrawer";
import type { ShareCardImageProps, ShareCardSinger } from "./ShareCardImage";
import type { DialogShare } from "./ShareDialog";
import type { PlayerColors } from "../logic/playerColor";

/** The song on the score screen: what cardNames reads, and its video and chart */
type ShareCardSong = NonNullable<Parameters<typeof cardNames>[0]> & { videoId?: string; lyrics?: string | null; title?: string };

/** A singer's end score on this song (the score screen's), before rankByScore ranks it */
export type ShareCardScore = Omit<ShareCardSinger, "rank"> & { previousBest?: number | null };
/** A singer as ranked (rankByScore) */
type Singer = ShareCardScore & { rank: number };

/** The singer's take of this song: its upload, answering with the recording once it is stored */
export interface ShareCardTake {
  /** null: the upload stored nothing */
  promise?: Promise<{ recordingId?: string; token?: string } | null>;
}

/** The play of the song on: its party, song and when it started */
export interface ShareCardPlay {
  partyId?: string;
  songId?: string;
  startedAt?: number;
}

export interface ShareCardProps {
  /** null until the song is loaded */
  songInfo: ShareCardSong | null;
  scores: ShareCardScore[];
  currentUserName: string;
  songId: string;
  playerColors: PlayerColors;
  take?: ShareCardTake | null;
  onVideo?: (share: DialogShare) => void;
  play?: ShareCardPlay | null;
}

type SongArt = Awaited<ReturnType<typeof loadSongArt>>;
type Melody = Awaited<ReturnType<typeof melodyOf>>;

/** The share image's preview: the image, what navigator.share gets, and the link with the share's code */
interface SharePreview {
  url: string;
  data: ShareData;
  link: string;
}

/**
 * ShareCard — the "Share Score" button of the score screen, and the image it
 * shares: a story-sized poster of your score on the song (ShareCardImage,
 * drawn by logic/shareImage.ts).
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
 * song's backing track, made by the server (routes/takes.ts). It takes a few
 * seconds, so it always opens in a preview to watch and share from there:
 * `onVideo` hands it to the party page (ShareDialog), where the next
 * song starting does not close it.
 *
 * The song link on the card (its text and QR code) carries the share's code
 * (logic/shareLinks.ts), which says who brought whoever opens it: one for
 * the card and one for the video of this play (`play`: { partyId, songId,
 * startedAt }), asked for with the art. After a good song (three stars or
 * more, or a previous best beaten) the button stands out and says so.
 */
const ShareCard = ({ songInfo, scores, currentUserName, songId, playerColors, take = null, onVideo, play = null }: ShareCardProps) => {
  const { t, i18n } = useTranslation();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false); // a second tap before the re-render is ignored too
  const [preview, setPreview] = useState<SharePreview | null>(null); // { url, data } when the share needs one more tap
  const [videoBusy, setVideoBusy] = useState(false);
  const [takeReady, setTakeReady] = useState<{ recordingId: string; token: string } | null>(null); // { recordingId, token } once this song's take is uploaded
  const prepared = useRef<Promise<[SongArt | null, Melody | null]> | null>(null);
  const drawer = useShareCardDrawer();

  const ranked = useMemo(() => rankByScore(scores), [scores]);
  const me = ranked.find(p => p.username === currentUserName);
  const hueOf = useCallback((name: string) => playerHue(playerColors, name), [playerColors]);

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
  const linkOf = (kind: "card" | "video") => shareLinkFor({
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

  const download = (blob: Blob) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.download = fileName;
    link.href = url;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };

  /** Your card with `songUrl` on it, as useShareCardDrawer draws it: drawer.draw (the share image, a JPEG Blob) or drawer.drawVideo (the share video's pictures) */
  const cardOf = async (mine: Singer, songUrl: string): Promise<[ShareCardImageProps, ShareCardPaint]> => {
    const [art, melody] = await prepare();
    const { rows, more } = leaderboardRows(ranked, mine.username);
    return [
      { names, me: mine, ranked, rows, more, hueOf, melody, art: art && { aspect: art.aspect }, songUrl, t },
      { art, hue: hueOf(mine.username) },
    ];
  };
  const shareTexts = (mine: Singer, songUrl: string) => {
    const score = mine.score.toLocaleString();
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
      const blob = await drawer.draw(...await cardOf(me, link)); // the share image
      const file = new File([blob], fileName, { type: "image/jpeg" });
      const data = { ...shareTexts(me, link), files: [file] };
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share(data);
          shareSent(link);
          return;
        } catch (e) {
          if (thrownField(e, "name") === "AbortError") return; // the sheet was closed
          // The tap's permission ran out while the image was drawn: share from a preview
          if (thrownField(e, "name") === "NotAllowedError") {
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

  // The share video: the card drawn here, the sound made on the server from the take.
  // Influencer mode: when the camera filmed the take's moment (logic/cameraClip.ts), with
  // the singer in it unless they choose the card alone in the dialog.
  // What was made is kept for the take: asked again, it opens at once
  useSyncExternalStore(footage.subscribe, footage.version); // the camera's moment arrives a little after the take
  const filmed = !!takeReady && !!footage.get(takeReady.recordingId);
  const madeVideo = useRef<Record<string, { link: string; blob: Blob }>>({}); // `${recordingId}:camera|card` -> what was made
  const shown = useRef<{ file: File; data: ShareData; link: string; blob: Blob } | null>(null);
  const handleShareVideo = async (withCamera = filmed) => {
    if (busyRef.current || !me || !takeReady) return;
    const segment = withCamera ? footage.get(takeReady.recordingId) : null;
    busyRef.current = true;
    setVideoBusy(true);
    // the other one of the dialog's choice is being made: the dialog says so meanwhile
    const choice = (on: boolean, busy = false) => (footage.get(takeReady.recordingId) ? { on, busy, onChange: (next: boolean) => { handleShareVideo(next); } } : undefined);
    if (shown.current) onVideo?.({ url: URL.createObjectURL(shown.current.blob), file: shown.current.file, data: shown.current.data, link: shown.current.link, camera: choice(!!segment, true) });
    try {
      const key = `${takeReady.recordingId}:${segment ? 'camera' : 'card'}`;
      let made = madeVideo.current[key];
      if (!made) {
        const link = await linkOf('video');
        const [card, paint] = await cardOf(me, link);
        // with the camera, the art's box is its window, and the card is yours alone (the leaderboard would shrink it)
        const pictures = await drawer.drawVideo(segment ? { ...card, art: null, camera: true, ranked: [card.me], rows: [card.me], more: 0 } : card, paint);
        made = { link, blob: await makeShareVideo({ ...takeReady, ...pictures, camera: segment ? segmentFile(segment) : null }) };
        madeVideo.current[key] = made;
      }
      const { blob, link } = made;
      const file = new File([blob], fileName.replace(/\.jpg$/, ".mp4"), { type: "video/mp4" });
      const data = { ...shareTexts(me, link), files: [file] };
      shown.current = { file, data, link, blob };
      onVideo?.({ url: URL.createObjectURL(blob), file, data, link, camera: choice(!!segment) });
    } catch (e) {
      console.error("Making the share video failed:", e);
      onVideo?.({ error: true });
    } finally {
      busyRef.current = false;
      setVideoBusy(false);
    }
  };

  const shareFromPreview = async (shown: SharePreview) => {
    try {
      await navigator.share(shown.data);
      shareSent(shown.link);
      setPreview(null);
    } catch (e) {
      if (thrownField(e, "name") !== "AbortError") console.error("Sharing the score image failed:", e);
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
          onClick={() => { shown.current = null; handleShareVideo(); }}
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
              onClick={e => { e.stopPropagation(); shareFromPreview(preview); }}
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
