import React, { useRef, useCallback } from "react";
import { toPng } from "html-to-image";
import { appDomain } from "../GlobalConsts";

/**
 * ShareCard — renders a Spotify-Wrapped-style shareable image card.
 *
 * The card is a hidden React-rendered div that gets captured via html-to-image.
 * Supports Web Share API for mobile, falls back to download on desktop.
 */
const ShareCard = ({ songInfo, scores, currentUserName }) => {
  const cardRef = useRef(null);

  const myScore = scores.find(s => s.username === currentUserName);
  const myRank = scores.findIndex(s => s.username === currentUserName) + 1;

  const handleShare = useCallback(async () => {
    if (!cardRef.current) return;

    try {
      const dataUrl = await toPng(cardRef.current, {
        width: 720,
        height: 1280,
        pixelRatio: 1,
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
          const file = new File([blob], "singpro-score.png", { type: "image/png" });
          if (navigator.canShare({ files: [file] })) {
            await navigator.share({
              title: `I scored ${myScore?.score?.toLocaleString() ?? 0} on ${songInfo?.title ?? "SingPro"}!`,
              text: `I just sang "${songInfo?.title}" by ${songInfo?.artist} on SingPro and scored ${myScore?.score?.toLocaleString() ?? 0} points! Think you can beat me? Try at ${appDomain}`,
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
      link.download = `singpro-${(songInfo?.title ?? "score").replace(/\W+/g, "-")}.png`;
      link.href = dataUrl;
      link.click();
    } catch (e) {
      console.error("Share card generation failed:", e);
    }
  }, [songInfo, scores, currentUserName, myScore]);

  if (!myScore) return null;

  const medals = ["\u{1F451}", "\u{1F948}", "\u{1F949}"];
  const medalText = medals[myRank - 1] ?? `#${myRank}`;
  const rankColors = ["#FFD700", "#C0C0C0", "#CD7F32"];
  const displayedScores = scores.slice(0, 5);

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
        Share Score
      </button>

      {/* Hidden card — positioned offscreen but fully laid out for html-to-image capture */}
      <div
        ref={cardRef}
        aria-hidden="true"
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          width: 720,
          height: 1280,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "flex-start",
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          background: "linear-gradient(135deg, #0a0a2e 0%, #1a0a3e 40%, #0a1a3e 70%, #0a0a1a 100%)",
          overflow: "hidden",
          // Move offscreen without affecting layout — html-to-image strips transform on clone
          transform: "translate(-9999px, 0)",
          pointerEvents: "none",
          zIndex: -1,
        }}
      >
        {/* Decorative glow orbs */}
        <div style={{
          position: "absolute", top: 50, left: -30, width: 400, height: 400,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(0,229,255,0.15) 0%, transparent 70%)",
        }} />
        <div style={{
          position: "absolute", top: 200, right: -50, width: 350, height: 350,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(213,0,249,0.12) 0%, transparent 70%)",
        }} />
        <div style={{
          position: "absolute", bottom: 200, left: 50, width: 400, height: 400,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(57,255,20,0.08) 0%, transparent 70%)",
        }} />
        <div style={{
          position: "absolute", bottom: 50, right: -20, width: 300, height: 300,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(255,215,0,0.1) 0%, transparent 70%)",
        }} />

        {/* Header */}
        <div style={{
          color: "rgba(255,255,255,0.3)", fontSize: 24, fontWeight: 700,
          letterSpacing: 4, marginTop: 40, textTransform: "uppercase",
        }}>
          SINGPRO
        </div>

        {/* Decorative line */}
        <div style={{
          width: 400, height: 2, margin: "16px 0",
          background: "linear-gradient(90deg, transparent, rgba(0,229,255,0.5) 30%, rgba(213,0,249,0.5) 70%, transparent)",
        }} />

        {/* "I just sang" */}
        <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 28, marginTop: 24 }}>
          I just sang
        </div>

        {/* Song title */}
        <div style={{
          color: "#ffffff", fontSize: 48, fontWeight: 700,
          textAlign: "center", padding: "12px 60px", lineHeight: 1.2,
          maxWidth: 660, wordBreak: "break-word",
        }}>
          {songInfo?.title || "Unknown"}
        </div>

        {/* Artist */}
        <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 32, marginTop: 4 }}>
          {songInfo?.artist || "Unknown Artist"}
        </div>

        {/* Score card */}
        <div style={{
          margin: "40px 60px 0", width: 600,
          background: "linear-gradient(135deg, rgba(255,255,255,0.08), rgba(255,255,255,0.03))",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 24, padding: "30px 40px",
          display: "flex", flexDirection: "column", alignItems: "center",
        }}>
          {/* Medal */}
          <div style={{ fontSize: 64, lineHeight: 1 }}>{medalText}</div>

          {/* Player name */}
          <div style={{ color: "#ffffff", fontSize: 36, fontWeight: 700, marginTop: 8 }}>
            {currentUserName}
          </div>

          {/* Score */}
          <div style={{
            fontSize: 80, fontWeight: 700, marginTop: 16, lineHeight: 1,
            background: "linear-gradient(90deg, #00e5ff, #d500f9)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
          }}>
            {myScore.score.toLocaleString()}
          </div>

          {/* Points label */}
          <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 24, marginTop: 4 }}>
            points
          </div>
        </div>

        {/* Leaderboard */}
        {scores.length > 1 && (
          <div style={{
            width: 600, margin: "32px 60px 0",
            display: "flex", flexDirection: "column", alignItems: "center",
          }}>
            <div style={{
              color: "rgba(255,255,255,0.35)", fontSize: 20, fontWeight: 700,
              letterSpacing: 3, textTransform: "uppercase", marginBottom: 12,
            }}>
              LEADERBOARD
            </div>

            {displayedScores.map((p, i) => {
              const isMe = p.username === currentUserName;
              return (
                <div
                  key={p.username}
                  style={{
                    display: "flex", alignItems: "center", width: "100%",
                    padding: "10px 20px", borderRadius: 10, marginBottom: 4,
                    background: isMe ? "rgba(0,229,255,0.08)" : "transparent",
                  }}
                >
                  <span style={{
                    color: rankColors[i] ?? "rgba(255,255,255,0.5)",
                    fontSize: 22, fontWeight: 700, width: 40,
                  }}>
                    {i + 1}.
                  </span>
                  <span style={{
                    color: isMe ? "#00e5ff" : "rgba(255,255,255,0.8)",
                    fontSize: 22, fontWeight: isMe ? 700 : 400, flex: 1,
                  }}>
                    {p.username}
                  </span>
                  <span style={{
                    color: isMe ? "#00e5ff" : "rgba(255,255,255,0.6)",
                    fontSize: 22, fontWeight: 700,
                  }}>
                    {p.score.toLocaleString()}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* CTA section */}
        <div style={{
          marginTop: "auto", paddingBottom: 60,
          display: "flex", flexDirection: "column", alignItems: "center",
        }}>
          {/* Decorative line */}
          <div style={{
            width: 480, height: 1, marginBottom: 24,
            background: "linear-gradient(90deg, transparent, rgba(0,229,255,0.3) 50%, transparent)",
          }} />

          <div style={{ color: "rgba(255,255,255,0.45)", fontSize: 26 }}>
            Think you can beat my score?
          </div>

          <div style={{
            fontSize: 30, fontWeight: 700, marginTop: 12,
            background: "linear-gradient(90deg, #00e5ff, #d500f9)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
          }}>
            {appDomain}
          </div>

          {/* Tiny footer */}
          <div style={{
            color: "rgba(255,255,255,0.15)", fontSize: 16, marginTop: 24,
          }}>
            Free online karaoke with friends
          </div>
        </div>
      </div>
    </>
  );
};

export default ShareCard;
