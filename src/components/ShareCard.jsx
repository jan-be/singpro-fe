import React, { useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { toJpeg } from "html-to-image";
import { appDomain } from "../GlobalConsts";

/**
 * ShareCard — renders a Spotify-Wrapped-style shareable image card.
 *
 * The card is a hidden React-rendered div that gets captured via html-to-image.
 * Supports Web Share API for mobile, falls back to download on desktop.
 */
const ShareCard = ({ songInfo, scores, currentUserName }) => {
  const { t } = useTranslation();
  const cardRef = useRef(null);

  const myScore = scores.find(s => s.username === currentUserName);
  const myIndex = scores.findIndex(s => s.username === currentUserName);
  // Tied scores get the same rank
  const myRank = myIndex <= 0 ? 1
    : (myScore.score === scores[0].score ? 1
      : scores.findIndex(p => p.score === myScore.score) + 1);

  const handleShare = useCallback(async () => {
    if (!cardRef.current) return;

    try {
      const dataUrl = await toJpeg(cardRef.current, {
        width: 720,
        height: 1280,
        pixelRatio: 1,
        quality: 0.92,
        // html-to-image clones the node — override the clip/offscreen positioning
        // on the clone so it renders fully
        style: {
          transform: "none",
          position: "static",
        },
      });

      // Try Web Share API (mobile)
      if (navigator.share && navigator.canShare) {
        try {
          const resp = await fetch(dataUrl);
          const blob = await resp.blob();
          const file = new File([blob], "singpro-score.jpg", { type: "image/jpeg" });
          if (navigator.canShare({ files: [file] })) {
            await navigator.share({
              title: t('share.shareTitle', { score: myScore?.score?.toLocaleString() ?? 0, title: songInfo?.title ?? 'SingPro' }),
              text: t('share.shareText', {
                title: songInfo?.title,
                artist: songInfo?.artist,
                score: myScore?.score?.toLocaleString() ?? 0,
                domain: appDomain,
              }),
              files: [file],
            });
            return;
          }
        } catch (e) {
          if (e.name === "AbortError") return;
        }
      }

      // Fallback: download image
      const link = document.createElement("a");
      link.download = `singpro-${(songInfo?.title ?? "score").replace(/\W+/g, "-")}.jpg`;
      link.href = dataUrl;
      link.click();
    } catch (e) {
      console.error("Share card generation failed:", e);
    }
  }, [songInfo, scores, currentUserName, myScore, t]);

  if (!myScore) return null;

  const medals = ["\u{1F451}", "\u{1F948}", "\u{1F949}"];
  const medalText = medals[myRank - 1] ?? `#${myRank}`;
  const rankColors = ["text-yellow-400", "text-gray-300", "text-amber-600"];
  const displayedScores = scores.slice(0, 5);
  const thumbnailUrl = songInfo?.thumbnailUrl;

  return (
    <>
      {/* Share button */}
      <button
        onClick={handleShare}
        className="px-4 py-2 rounded-lg bg-gradient-to-r from-neon-cyan/20 to-neon-purple/20 text-white hover:from-neon-cyan/30 hover:to-neon-purple/30 border border-neon-cyan/30 hover:border-neon-cyan/50 transition-all text-sm font-semibold flex items-center gap-2"
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
          <polyline points="16 6 12 2 8 6" />
          <line x1="12" y1="2" x2="12" y2="15" />
        </svg>
        {t('share.shareScore')}
      </button>

      {/* Hidden card — positioned offscreen but fully laid out for html-to-image capture */}
      <div
        ref={cardRef}
        aria-hidden="true"
        className="fixed top-0 left-0 flex flex-col items-center justify-start overflow-hidden pointer-events-none -z-10"
        style={{
          width: 720,
          height: 1280,
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          background: "linear-gradient(135deg, #0a0a2e 0%, #1a0a3e 40%, #0a1a3e 70%, #0a0a1a 100%)",
          transform: "translate(-9999px, 0)",
        }}
      >
        {/* Decorative glow orbs */}
        <div className="absolute rounded-full" style={{ top: 50, left: -30, width: 400, height: 400, background: "radial-gradient(circle, rgba(0,229,255,0.15) 0%, transparent 70%)" }} />
        <div className="absolute rounded-full" style={{ top: 200, right: -50, width: 350, height: 350, background: "radial-gradient(circle, rgba(213,0,249,0.12) 0%, transparent 70%)" }} />
        <div className="absolute rounded-full" style={{ bottom: 200, left: 50, width: 400, height: 400, background: "radial-gradient(circle, rgba(57,255,20,0.08) 0%, transparent 70%)" }} />
        <div className="absolute rounded-full" style={{ bottom: 50, right: -20, width: 300, height: 300, background: "radial-gradient(circle, rgba(255,215,0,0.1) 0%, transparent 70%)" }} />

        {/* Logo */}
        <img src="/logo.png" alt="SingPro" className="w-20 h-20 object-contain mt-8" />

        {/* Header */}
        <div className="text-white/30 text-2xl font-bold tracking-widest mt-2 uppercase">
          SINGPRO
        </div>

        {/* Decorative line */}
        <div className="h-0.5 my-4" style={{ width: 400, background: "linear-gradient(90deg, transparent, rgba(0,229,255,0.5) 30%, rgba(213,0,249,0.5) 70%, transparent)" }} />

        {/* Thumbnail + song info */}
        {thumbnailUrl ? (
          <div className="flex items-center gap-6 mt-6 px-16 w-full">
            <img
              src={thumbnailUrl}
              alt=""
              className="w-28 h-28 rounded-2xl object-cover flex-shrink-0"
              style={{ border: "2px solid rgba(255,255,255,0.15)" }}
              crossOrigin="anonymous"
            />
            <div className="flex flex-col min-w-0">
              <div className="text-white/50 text-lg">{t('share.iJustSang')}</div>
              <div className="text-white text-3xl font-bold leading-tight break-words">
                {songInfo?.title || "Unknown"}
              </div>
              <div className="text-white/60 text-xl mt-1">
                {songInfo?.artist || "Unknown Artist"}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center mt-6">
            <div className="text-white/50 text-3xl">{t('share.iJustSang')}</div>
            <div className="text-white text-5xl font-bold text-center px-16 leading-tight break-words mt-3" style={{ maxWidth: 660 }}>
              {songInfo?.title || "Unknown"}
            </div>
            <div className="text-white/60 text-3xl mt-1">
              {songInfo?.artist || "Unknown Artist"}
            </div>
          </div>
        )}

        {/* Score card */}
        <div
          className="flex flex-col items-center rounded-3xl mt-10 mx-16"
          style={{
            width: 600,
            padding: "30px 40px",
            background: "linear-gradient(135deg, rgba(255,255,255,0.08), rgba(255,255,255,0.03))",
            border: "1px solid rgba(255,255,255,0.1)",
          }}
        >
          {/* Medal */}
          <div className="text-6xl leading-none">{medalText}</div>

          {/* Player name */}
          <div className="text-white text-4xl font-bold mt-2">{currentUserName}</div>

          {/* Score */}
          <div
            className="text-7xl font-bold mt-4 leading-none bg-clip-text"
            style={{
              fontSize: 80,
              background: "linear-gradient(90deg, #00e5ff, #d500f9)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            {myScore.score.toLocaleString()}
          </div>

          {/* Points label */}
          <div className="text-white/40 text-2xl mt-1">{t('share.points')}</div>
        </div>

        {/* Leaderboard */}
        {scores.length > 1 && (
          <div className="flex flex-col items-center mt-8 mx-16" style={{ width: 600 }}>
            <div className="text-white/35 text-xl font-bold tracking-widest uppercase mb-3">
              {t('share.leaderboard')}
            </div>

            {displayedScores.map((p, i) => {
              const isMe = p.username === currentUserName;
              const pRank = i === 0 ? 0
                : (p.score === displayedScores[i - 1].score
                  ? displayedScores.findIndex(s => s.score === p.score)
                  : i);
              return (
                <div
                  key={p.username}
                  className={`flex items-center w-full px-5 py-2.5 rounded-xl mb-1 ${isMe ? "bg-neon-cyan/8" : ""}`}
                >
                  <span className={`text-xl font-bold w-10 ${rankColors[pRank] ?? "text-white/50"}`}>
                    {pRank + 1}.
                  </span>
                  <span className={`text-xl flex-1 ${isMe ? "text-neon-cyan font-bold" : "text-white/80"}`}>
                    {p.username}
                  </span>
                  <span className={`text-xl font-bold ${isMe ? "text-neon-cyan" : "text-white/60"}`}>
                    {p.score.toLocaleString()}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* CTA section */}
        <div className="mt-auto pb-16 flex flex-col items-center">
          {/* Decorative line */}
          <div className="h-px mb-6" style={{ width: 480, background: "linear-gradient(90deg, transparent, rgba(0,229,255,0.3) 50%, transparent)" }} />

          <div className="text-white/45 text-2xl">
            {t('share.beatMyScore')}
          </div>

          <div
            className="text-3xl font-bold mt-3 bg-clip-text"
            style={{
              background: "linear-gradient(90deg, #00e5ff, #d500f9)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            {appDomain}
          </div>

          <div className="text-white/15 text-base mt-6">
            {t('share.tagline')}
          </div>
        </div>
      </div>
    </>
  );
};

export default ShareCard;
