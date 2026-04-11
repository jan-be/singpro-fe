import React, { useRef, useCallback } from "react";

/**
 * ShareCard — renders a Spotify-Wrapped-style shareable image card.
 *
 * Uses an offscreen canvas to draw the card (no html2canvas dependency).
 * Supports Web Share API for mobile, falls back to download on desktop.
 */
const ShareCard = ({ songInfo, scores, currentUserName }) => {
  const canvasRef = useRef(null);

  const myScore = scores.find(s => s.username === currentUserName);
  const myRank = scores.findIndex(s => s.username === currentUserName) + 1;

  const drawCard = useCallback(() => {
    const W = 720;
    const H = 1280;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");

    // Background gradient
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, "#0a0a2e");
    bg.addColorStop(0.4, "#1a0a3e");
    bg.addColorStop(0.7, "#0a1a3e");
    bg.addColorStop(1, "#0a0a1a");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Decorative circles (abstract art)
    const drawGlow = (x, y, r, color, alpha) => {
      const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, color.replace("1)", `${alpha})`));
      grad.addColorStop(1, "transparent");
      ctx.fillStyle = grad;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    };
    drawGlow(120, 200, 300, "rgba(0,229,255,1)", 0.15);
    drawGlow(600, 400, 250, "rgba(213,0,249,1)", 0.12);
    drawGlow(350, 900, 350, "rgba(57,255,20,1)", 0.08);
    drawGlow(100, 1100, 200, "rgba(255,215,0,1)", 0.1);

    // SingPro logo / header
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(255,255,255,0.3)";
    ctx.font = "bold 24px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillText("SINGPRO", W / 2, 60);

    // Decorative line
    const lineGrad = ctx.createLinearGradient(160, 0, W - 160, 0);
    lineGrad.addColorStop(0, "transparent");
    lineGrad.addColorStop(0.3, "rgba(0,229,255,0.5)");
    lineGrad.addColorStop(0.7, "rgba(213,0,249,0.5)");
    lineGrad.addColorStop(1, "transparent");
    ctx.strokeStyle = lineGrad;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(160, 80);
    ctx.lineTo(W - 160, 80);
    ctx.stroke();

    // "I just sang" text
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.font = "400 28px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillText("I just sang", W / 2, 160);

    // Song title
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 48px -apple-system, BlinkMacSystemFont, sans-serif";
    const title = songInfo?.title || "Unknown";
    wrapText(ctx, title, W / 2, 230, W - 120, 56);

    // Artist
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.font = "400 32px -apple-system, BlinkMacSystemFont, sans-serif";
    const artist = songInfo?.artist || "Unknown Artist";
    ctx.fillText(artist, W / 2, 310);

    // Score card background
    const cardY = 380;
    const cardH = 280;
    ctx.save();
    roundRect(ctx, 60, cardY, W - 120, cardH, 24);
    ctx.clip();
    const cardBg = ctx.createLinearGradient(60, cardY, W - 60, cardY + cardH);
    cardBg.addColorStop(0, "rgba(255,255,255,0.08)");
    cardBg.addColorStop(1, "rgba(255,255,255,0.03)");
    ctx.fillStyle = cardBg;
    ctx.fillRect(60, cardY, W - 120, cardH);
    ctx.restore();

    // Card border
    ctx.strokeStyle = "rgba(255,255,255,0.1)";
    ctx.lineWidth = 1.5;
    roundRect(ctx, 60, cardY, W - 120, cardH, 24);
    ctx.stroke();

    if (myScore) {
      // Rank medal
      const medals = ["\u{1F451}", "\u{1F948}", "\u{1F949}"];
      const medalText = medals[myRank - 1] ?? `#${myRank}`;
      ctx.font = "64px -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.fillText(medalText, W / 2, cardY + 70);

      // Player name
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 36px -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.fillText(currentUserName, W / 2, cardY + 120);

      // Score
      const scoreGrad = ctx.createLinearGradient(W / 2 - 100, 0, W / 2 + 100, 0);
      scoreGrad.addColorStop(0, "#00e5ff");
      scoreGrad.addColorStop(1, "#d500f9");
      ctx.fillStyle = scoreGrad;
      ctx.font = "bold 80px -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.fillText(myScore.score.toLocaleString(), W / 2, cardY + 215);

      // Points label
      ctx.fillStyle = "rgba(255,255,255,0.4)";
      ctx.font = "400 24px -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.fillText("points", W / 2, cardY + 250);
    }

    // All players leaderboard
    if (scores.length > 1) {
      let leaderY = 710;
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.font = "bold 20px -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.letterSpacing = "3px";
      ctx.fillText("LEADERBOARD", W / 2, leaderY);
      ctx.letterSpacing = "0px";
      leaderY += 16;

      const maxDisplayed = Math.min(scores.length, 5);
      for (let i = 0; i < maxDisplayed; i++) {
        const p = scores[i];
        leaderY += 48;
        const isMe = p.username === currentUserName;
        const rankColors = ["#FFD700", "#C0C0C0", "#CD7F32"];

        // Row background for current user
        if (isMe) {
          ctx.fillStyle = "rgba(0,229,255,0.08)";
          roundRect(ctx, 100, leaderY - 32, W - 200, 44, 10);
          ctx.fill();
        }

        // Rank
        ctx.fillStyle = rankColors[i] ?? "rgba(255,255,255,0.5)";
        ctx.font = `bold 22px -apple-system, BlinkMacSystemFont, sans-serif`;
        ctx.textAlign = "left";
        ctx.fillText(`${i + 1}.`, 130, leaderY);

        // Name
        ctx.fillStyle = isMe ? "#00e5ff" : "rgba(255,255,255,0.8)";
        ctx.font = `${isMe ? "bold " : ""}22px -apple-system, BlinkMacSystemFont, sans-serif`;
        ctx.fillText(p.username, 170, leaderY);

        // Score
        ctx.fillStyle = isMe ? "#00e5ff" : "rgba(255,255,255,0.6)";
        ctx.font = "bold 22px -apple-system, BlinkMacSystemFont, sans-serif";
        ctx.textAlign = "right";
        ctx.fillText(p.score.toLocaleString(), W - 130, leaderY);
        ctx.textAlign = "center";
      }
    }

    // CTA
    const ctaY = scores.length > 1 ? 1060 : 780;

    // Decorative line 2
    const line2Grad = ctx.createLinearGradient(120, 0, W - 120, 0);
    line2Grad.addColorStop(0, "transparent");
    line2Grad.addColorStop(0.5, "rgba(0,229,255,0.3)");
    line2Grad.addColorStop(1, "transparent");
    ctx.strokeStyle = line2Grad;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(120, ctaY - 30);
    ctx.lineTo(W - 120, ctaY - 30);
    ctx.stroke();

    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.font = "400 26px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillText("Think you can beat my score?", W / 2, ctaY + 10);

    // URL
    const urlGrad = ctx.createLinearGradient(W / 2 - 80, 0, W / 2 + 80, 0);
    urlGrad.addColorStop(0, "#00e5ff");
    urlGrad.addColorStop(1, "#d500f9");
    ctx.fillStyle = urlGrad;
    ctx.font = "bold 30px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillText("singpro.app", W / 2, ctaY + 55);

    // Tiny footer
    ctx.fillStyle = "rgba(255,255,255,0.15)";
    ctx.font = "16px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillText("Free online karaoke with friends", W / 2, H - 30);

    return canvas;
  }, [songInfo, scores, currentUserName, myScore, myRank]);

  const handleShare = useCallback(async () => {
    const canvas = drawCard();

    // Try Web Share API (mobile)
    if (navigator.share && navigator.canShare) {
      try {
        const blob = await new Promise(r => canvas.toBlob(r, "image/png"));
        const file = new File([blob], "singpro-score.png", { type: "image/png" });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({
            title: `I scored ${myScore?.score?.toLocaleString() ?? 0} on ${songInfo?.title ?? "SingPro"}!`,
            text: `I just sang "${songInfo?.title}" by ${songInfo?.artist} on SingPro and scored ${myScore?.score?.toLocaleString() ?? 0} points! Think you can beat me? Try at singpro.app`,
            files: [file],
          });
          return;
        }
      } catch (e) {
        if (e.name === "AbortError") return; // user cancelled
      }
    }

    // Fallback: download image
    const link = document.createElement("a");
    link.download = `singpro-${(songInfo?.title ?? "score").replace(/\W+/g, "-")}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }, [drawCard, songInfo, myScore]);

  if (!myScore) return null;

  return (
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
  );
};

// Canvas helper: draw a rounded rectangle path
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// Canvas helper: wrap text to fit within maxWidth
function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(" ");
  let line = "";
  let curY = y;
  for (const word of words) {
    const test = line + (line ? " " : "") + word;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, curY);
      line = word;
      curY += lineHeight;
    } else {
      line = test;
    }
  }
  ctx.fillText(line, x, curY);
}

export default ShareCard;
