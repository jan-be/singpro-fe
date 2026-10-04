import React, { useId } from "react";
import { QRCodeSVG } from "qrcode.react";
import AppIcon from "./AppIcon";
import { MAX_SCORE, STAR_THRESHOLDS } from "../logic/scoreScale";
import { CARD_WIDTH, CARD_HEIGHT, waveform } from "../logic/shareImage";
import { achievementInfo } from "../logic/achievements";

/**
 * The share image's card (logic/shareImage.js draws it): a poster of one
 * song's score, laid out at CARD_WIDTH × CARD_HEIGHT. The background and the
 * song's art are painted under it on a canvas, so the card itself is
 * transparent and only keeps a box (data-share-art) where the art goes.
 *
 * Everything is inline SVG, text, borders and CSS gradients: no web fonts,
 * no <img>, no backdrop-filter, no CSS filters, no background-clip text and
 * no CSS shadows, which are what html-to-image draws unreliably on iOS
 * Safari and Android (WebKit puts shadows in the wrong place once the
 * picture is scaled). Glows and drop shadows are asked for with data-glow
 * and painted on the canvas under the card.
 *
 * Top to bottom: the art with your rank stuck on it, the song, your score
 * over the song's melody as a progress bar with the stars on their
 * thresholds, what the song earned you (a new best, achievements), the
 * others, and the way in (QR code and link). With three
 * or more singers everything is a little smaller so the leaderboard fits;
 * logic/shareImage.js layoutCard then fits the texts and, if the card still
 * runs over, shrinks the art.
 */

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif";
const PAD = 48;
const INNER = CARD_WIDTH - 2 * PAD;
const STAR = "M12 1.6l3.05 6.5 7.1.86-5.24 4.88 1.38 7.04L12 17.4l-6.29 3.48 1.38-7.04L1.85 8.96l7.1-.86z";

const hsl = (h, l = 60, a = 1) => `hsla(${Math.round(h) % 360}, 100%, ${l}%, ${a})`;

// Letter-spacing pulls apart scripts whose letters join (Arabic) or hang
// from one line (Devanagari, Bengali, …); labels in those keep their spacing
const JOINED = /[֐-ࣿऀ-෿฀-๿]/;
const spaced = (text, em) => (JOINED.test(text) ? "normal" : em);

// Podium colours: the rank sticker's face and ink, the leaderboard's numbers
const PODIUM = [
  { face: "radial-gradient(circle at 32% 28%, #fff7cc 0%, #ffd84a 42%, #e9a400 100%)", ink: "#3b2700", text: "#ffd84a" },
  { face: "radial-gradient(circle at 32% 28%, #ffffff 0%, #dfe3ec 45%, #9ea7b8 100%)", ink: "#1d2331", text: "#dfe3ec" },
  { face: "radial-gradient(circle at 32% 28%, #ffe0bd 0%, #e69c5c 45%, #a35a2a 100%)", ink: "#2f1606", text: "#eda56a" },
];

const GoldDefs = ({ id }) => (
  <>
    <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stopColor="#fff6c4" />
      <stop offset="0.45" stopColor="#ffd23f" />
      <stop offset="1" stopColor="#f59e0b" />
    </linearGradient>
    <radialGradient id={`${id}-halo`}>
      <stop offset="0.3" stopColor="rgba(255,200,40,0.55)" />
      <stop offset="1" stopColor="rgba(255,200,40,0)" />
    </radialGradient>
  </>
);

/** A star centred on (x, y): gold with a halo when earned, a faint outline when not. */
const Star = ({ x, y, size, earned, gold }) => (
  <g transform={`translate(${x - size / 2} ${y - size / 2}) scale(${size / 24})`}>
    {earned && <circle cx="12" cy="12" r="16" fill={`url(#${gold}-halo)`} />}
    <path
      d={STAR}
      fill={earned ? `url(#${gold})` : "rgba(255,255,255,0.06)"}
      stroke={earned ? "#fff3b0" : "rgba(255,255,255,0.4)"}
      strokeWidth={earned ? 0.6 : 1.3}
      strokeLinejoin="round"
    />
  </g>
);

/** Three small stars for a leaderboard row. */
const MiniStars = ({ stars, gold }) => (
  <svg width="58" height="18" viewBox="0 0 58 18" style={{ flexShrink: 0, display: "block" }}>
    <defs><GoldDefs id={gold} /></defs>
    {STAR_THRESHOLDS.map((_, i) => <Star key={i} x={9 + i * 20} y={9} size={17} earned={i < stars} gold={gold} />)}
  </svg>
);

/**
 * The score meter: the song's melody as a waveform, lit in the singer's
 * colour up to the score (out of 10,000) like a player's progress bar, with
 * the three stars standing on their thresholds. Without a melody the bars
 * are all the same height.
 */
const Meter = ({ melody, score, hue, ids, dense }) => {
  const W = INNER;
  const starSize = dense ? 36 : 42;
  const waveTop = starSize + 18, waveH = dense ? 56 : 70;
  const H = waveTop + waveH + 14;
  const mid = waveTop + waveH / 2;
  const bins = 60;
  const levels = melody ? waveform(melody, bins) : Array(bins).fill(0.5);
  const step = W / bins, barW = step * 0.58;
  const fx = Math.max(0, Math.min(1, score / MAX_SCORE)) * W;
  const bars = levels.map((level, i) => {
    const h = level > 0 ? Math.max(8, level * waveH) : 4;
    return { x: i * step + (step - barW) / 2, y: mid - h / 2, h, silent: level === 0 };
  });
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: "block", overflow: "visible" }}>
      <defs>
        <linearGradient id={ids.fill} x1="0" y1="0" x2={W} y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={hsl(hue, 56)} />
          <stop offset="1" stopColor={hsl(hue + 45, 70)} />
        </linearGradient>
        <clipPath id={ids.lit}><rect x="0" y="0" width={fx} height={H} /></clipPath>
        <clipPath id={ids.dim}><rect x={fx} y="0" width={W - fx} height={H} /></clipPath>
        <GoldDefs id={ids.gold} />
      </defs>

      {/* Star thresholds: a dashed line from each star down through the waveform */}
      {STAR_THRESHOLDS.map(t => {
        const x = (t / MAX_SCORE) * W;
        return <line key={t} x1={x} x2={x} y1={starSize + 4} y2={H - 4} stroke="rgba(255,255,255,0.25)" strokeWidth="1.5" strokeDasharray="3 5" />;
      })}

      <g clipPath={`url(#${ids.dim})`}>
        {bars.map((b, i) => <rect key={i} x={b.x} y={b.y} width={barW} height={b.h} rx={barW / 2} fill={b.silent ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.22)"} />)}
      </g>
      <g clipPath={`url(#${ids.lit})`}>
        {bars.map((b, i) => <rect key={i} x={b.x - 3} y={b.y - 3} width={barW + 6} height={b.h + 6} rx={barW / 2 + 3} fill={hsl(hue + (45 * b.x) / W, 62, 0.22)} />)}
        {bars.map((b, i) => <rect key={i} x={b.x} y={b.y} width={barW} height={b.h} rx={barW / 2} fill={`url(#${ids.fill})`} opacity={b.silent ? 0.6 : 1} />)}
      </g>

      {/* Where the score landed */}
      <rect x={fx - 1.25} y={waveTop - 8} width="2.5" height={waveH + 16} rx="1.25" fill="#fff" />
      <circle cx={fx} cy={waveTop + waveH + 8} r="7" fill="#fff" stroke={hsl(hue, 62)} strokeWidth="3" />

      {STAR_THRESHOLDS.map(t => <Star key={t} x={(t / MAX_SCORE) * W} y={starSize / 2 + 1} size={starSize} earned={score >= t} gold={ids.gold} />)}
    </svg>
  );
};

/**
 * Room for "singpro.app" in the app's cyan → purple → magenta. The letters
 * are painted on the canvas under the card (shareImage.js, paintWordmarks),
 * measured there and shrunk to fit the box: as SVG text squeezed with
 * textLength, iPhone Safari ignored the squeeze inside html-to-image's
 * picture, and the name ran past its box, cut to "singpro.a".
 */
const Wordmark = ({ height }) => (
  <div
    data-wordmark="singpro.app"
    role="img"
    aria-label="singpro.app"
    style={{ width: Math.round(height * 4.6), height: Math.round(height * 1.3), fontSize: height, fontWeight: 800, flexShrink: 0 }}
  />
);

/** Free room, shared out evenly between the sections, never less than `min`. */
const Gap = ({ min }) => <div style={{ flex: "1 1 0", minHeight: min }} />;

const ShareCardImage = React.forwardRef(function ShareCardImage({
  names, me, ranked, rows, more, hueOf, melody, songUrl, art, t,
}, ref) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, ""); // usable in url(#…) whatever React puts in it
  const hue = hueOf(me.username);
  const perfect = me.score >= MAX_SCORE;
  const solo = ranked.length < 2;
  const dense = ranked.length >= 3;
  const podium = PODIUM[me.rank - 1];
  const badges = [
    ...(me.newBest ? [{ key: "newBest", icon: "★", name: t('scores.newBest'), best: true }] : []),
    ...(me.achievements ?? []).map(achievementInfo).filter(Boolean),
  ];
  const shownBadges = badges.slice(0, 2);
  const eyebrow = t('share.iJustSang');
  const duetLabel = me.part ? `${t('party.duetOn')} · ${me.part === 2 ? t('party.duetP2') : t('party.duetP1')}` : null;

  // The art box: the picture's own shape (a square cover, a wide still) at
  // the most this tall; without art a square of the singer's colour
  const aspect = art ? Math.min(2.4, Math.max(0.8, art.aspect)) : 1;
  const maxHeight = art ? (dense ? 300 : 352) : (dense ? 220 : 280);
  const artHeight = Math.round(Math.min(maxHeight, INNER / aspect));
  const artWidth = Math.round(artHeight * aspect);

  return (
    <div
      ref={ref}
      aria-hidden="true"
      style={{
        position: "fixed", left: 0, top: 0, transform: "translateX(-10000px)", pointerEvents: "none",
        width: CARD_WIDTH, height: CARD_HEIGHT, overflow: "hidden", boxSizing: "border-box",
        padding: `0 ${PAD}px 40px`, display: "flex", flexDirection: "column", alignItems: "center",
        fontFamily: FONT, color: "#fff", textAlign: "center", background: "transparent",
        WebkitFontSmoothing: "antialiased",
      }}
    >
      {/* A soft light of the singer's colour behind the score */}
      <div style={{ position: "absolute", left: -200, right: -200, top: dense ? 360 : 460, height: 640, background: `radial-gradient(closest-side, ${hsl(hue, 55, 0.2)}, ${hsl(hue, 55, 0)})` }} />

      <Gap min={44} />

      {/* The song's art (painted under the card), with the rank stuck on it */}
      <div data-share-art-frame data-aspect={aspect} data-min-height="150" style={{ position: "relative", width: artWidth, height: artHeight, flexShrink: 0 }}>
        <div
          data-share-art data-glow={hsl(hue, 60, 0.45)} data-glow-blur="44"
          style={{
            position: "absolute", left: 0, top: 0, right: 0, bottom: 0, borderRadius: 26, boxSizing: "border-box",
            border: `2px solid ${hsl(hue, 62, 0.5)}`,
            background: art ? "transparent" : `linear-gradient(135deg, ${hsl(hue, 24)} 0%, ${hsl(hue + 50, 12)} 100%)`,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          {!art && <AppIcon width="56%" height="56%" />}
        </div>

        {!solo && (
          <div data-glow="rgba(0,0,0,0.55)" data-glow-blur="28" data-glow-y="12" style={{
            position: "absolute", right: -26, bottom: -30, width: dense ? 108 : 120, height: dense ? 108 : 120, borderRadius: "50%",
            transform: "rotate(-9deg)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            background: podium?.face ?? "#16132e", color: podium?.ink ?? "#fff",
            border: podium ? "3px solid rgba(255,255,255,0.7)" : `3px solid ${hsl(hue, 62)}`,
          }}>
            <div style={{ fontSize: dense ? 44 : 50, fontWeight: 900, lineHeight: 1, letterSpacing: "-0.03em" }}>#{me.rank}</div>
            <div style={{ fontSize: 19, fontWeight: 800, lineHeight: 1, marginTop: 4, opacity: 0.7 }}>/ {ranked.length}</div>
          </div>
        )}

      </div>

      {/* The rank sticker hangs 30px below the art */}
      <Gap min={solo ? 34 : 44} />

      {/* The song */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 18, fontWeight: 800, letterSpacing: spaced(eyebrow, "0.16em"), textTransform: "uppercase", color: hsl(hue, 80, 0.95) }}>
          {eyebrow}
        </span>
        {duetLabel && (
          <span style={{ fontSize: 15, fontWeight: 800, letterSpacing: spaced(duetLabel, "0.08em"), textTransform: "uppercase", color: "#ead0ff", border: "1.5px solid rgba(180,74,255,0.75)", borderRadius: 999, padding: "3px 12px" }}>
            {duetLabel}
          </span>
        )}
      </div>
      <div
        data-fit="title" data-fit-max={dense ? 46 : 54} data-fit-min="32" data-fit-lines={solo ? 3 : 2} data-fit-lh="1.1"
        lang={names.lang} dir="auto"
        style={{ marginTop: 8, width: "100%", fontSize: dense ? 46 : 54, fontWeight: 800, lineHeight: 1.1, letterSpacing: "-0.015em", overflowWrap: "break-word", textWrap: "balance" }}
      >
        {names.title || "singpro.app"}
      </div>
      <div
        data-fit="artist" data-fit-max={dense ? 25 : 28} data-fit-min="21" data-fit-lines={dense ? 1 : 2} data-fit-lh="1.2"
        lang={names.lang} dir="auto"
        style={{ marginTop: 6, width: "100%", fontSize: 28, fontWeight: 500, lineHeight: 1.2, color: "rgba(255,255,255,0.72)", overflowWrap: "break-word", textWrap: "balance" }}
      >
        {names.artist}
      </div>
      {names.roman && (
        <div data-fit="roman" data-fit-max="19" data-fit-min="17" data-fit-lines="1" data-fit-lh="1.25" dir="auto" style={{ marginTop: 4, width: "100%", fontSize: 19, fontWeight: 500, lineHeight: 1.25, color: "rgba(255,255,255,0.42)" }}>
          {names.roman}
        </div>
      )}

      <Gap min={dense ? 16 : 22} />

      {/* The score */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, maxWidth: "100%" }}>
        <span data-glow={hsl(hue, 60, 0.9)} data-glow-blur="12" style={{ width: 13, height: 13, borderRadius: "50%", background: hsl(hue, 60), flexShrink: 0 }} />
        <span data-fit="name" data-fit-max={dense ? 24 : 27} data-fit-min="20" data-fit-lines="1" data-fit-lh="1.2" dir="auto" style={{ fontSize: 27, fontWeight: 800, lineHeight: 1.2, color: hsl(hue, 78), overflowWrap: "anywhere", wordBreak: "break-word" }}>
          {me.username}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center", gap: 12 }}>
        <span data-glow={perfect ? "rgba(255,190,30,0.7)" : hsl(hue, 58, 0.6)} data-glow-blur="34" data-glow-text style={{
          fontSize: dense ? 112 : 132, fontWeight: 900, lineHeight: 1.02, letterSpacing: "-0.035em", fontVariantNumeric: "tabular-nums",
          color: perfect ? "#ffe27a" : "#fff",
        }}>
          {me.score.toLocaleString()}
        </span>
        <span style={{ fontSize: dense ? 23 : 26, fontWeight: 700, color: "rgba(255,255,255,0.45)", whiteSpace: "nowrap" }}>
          / {MAX_SCORE.toLocaleString()}
        </span>
      </div>

      <div style={{ marginTop: dense ? 8 : 12, flexShrink: 0 }}>
        <Meter melody={melody} score={me.score} hue={hue} dense={dense} ids={{ fill: `${uid}-fill`, gold: `${uid}-gold`, lit: `${uid}-lit`, dim: `${uid}-dim` }} />
      </div>

      {/* What this song earned: a new best, achievements */}
      {shownBadges.length > 0 && (
        <div style={{ marginTop: 14, display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 10, maxWidth: "100%", flexShrink: 0 }}>
          {shownBadges.map(b => (
            <span key={b.key} style={{
              display: "inline-flex", alignItems: "center", gap: 8, maxWidth: INNER, padding: "6px 16px", borderRadius: 999,
              fontSize: 19, fontWeight: 800, lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              ...(b.best
                ? { background: "linear-gradient(90deg, #ff00e5, #b44aff)", border: "1.5px solid rgba(255,255,255,0.35)" }
                : { border: "1.5px solid rgba(255,0,229,0.6)", background: "rgba(255,0,229,0.14)" }),
            }}>
              <span>{b.icon}</span>{b.name}
            </span>
          ))}
          {badges.length > shownBadges.length && (
            <span style={{ padding: "6px 14px", borderRadius: 999, fontSize: 19, fontWeight: 800, lineHeight: 1.2, border: "1.5px solid rgba(255,0,229,0.6)", background: "rgba(255,0,229,0.14)" }}>
              +{badges.length - shownBadges.length}
            </span>
          )}
        </div>
      )}

      {/* Everyone else, compactly */}
      {!solo && (
        <>
          <Gap min={dense ? 18 : 22} />
          <div style={{ width: "100%", borderRadius: 22, background: "rgba(255,255,255,0.055)", border: "1px solid rgba(255,255,255,0.1)", padding: "6px 0", flexShrink: 0, overflow: "hidden" }}>
            {rows.map(p => {
              const mine = p.username === me.username;
              const h = hueOf(p.username);
              return (
                <div key={p.username} style={{
                  display: "flex", alignItems: "center", gap: 14, height: dense ? 40 : 44, padding: "0 22px 0 14px", textAlign: "left",
                  background: mine ? hsl(hue, 60, 0.16) : "transparent",
                  borderLeft: `4px solid ${mine ? hsl(hue, 62) : "transparent"}`,
                }}>
                  <span style={{ width: 34, fontSize: 21, fontWeight: 900, color: PODIUM[p.rank - 1]?.text ?? "rgba(255,255,255,0.5)", fontVariantNumeric: "tabular-nums" }}>{p.rank}</span>
                  <span style={{ width: 11, height: 11, borderRadius: "50%", background: hsl(h, 60), flexShrink: 0 }} />
                  <span dir="auto" style={{ flex: 1, minWidth: 0, fontSize: 21, fontWeight: mine ? 800 : 600, color: mine ? hsl(hue, 80) : "rgba(255,255,255,0.88)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {p.username}
                  </span>
                  {p.part && (
                    <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: spaced(t('party.duetP1'), "0.06em"), textTransform: "uppercase", color: "#ead0ff", border: "1.5px solid rgba(180,74,255,0.65)", borderRadius: 999, padding: "2px 9px", flexShrink: 0 }}>
                      {p.part === 2 ? t('party.duetP2') : t('party.duetP1')}
                    </span>
                  )}
                  <MiniStars stars={p.stars ?? 0} gold={`${uid}-g${p.rank}`} />
                  <span style={{ width: 88, textAlign: "right", fontSize: 21, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: mine ? "#fff" : "rgba(255,255,255,0.75)" }}>
                    {p.score.toLocaleString()}
                  </span>
                </div>
              );
            })}
            {more > 0 && (
              <div style={{ height: 30, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 600, color: "rgba(255,255,255,0.5)" }}>
                {t('share.more', { count: more })}
              </div>
            )}
          </div>
        </>
      )}

      <Gap min={dense ? 20 : 26} />

      {/* The way in: a code for the song, the name, and what it is */}
      <div style={{ width: "100%", display: "flex", alignItems: "center", gap: 22, textAlign: "left", flexShrink: 0 }}>
        <div data-glow="rgba(0,0,0,0.45)" data-glow-blur="24" data-glow-y="8" style={{ background: "#fff", borderRadius: 16, padding: 9, flexShrink: 0 }}>
          <QRCodeSVG value={songUrl} size={dense ? 98 : 110} level="M" marginSize={0} bgColor="#ffffff" fgColor="#0b0a1a" style={{ display: "block" }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: dense ? 22 : 24, fontWeight: 800, lineHeight: 1.2 }}>{t('share.beatMyScore')}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
            <AppIcon width={dense ? 30 : 34} height={dense ? 30 : 34} style={{ flexShrink: 0, display: "block" }} />
            <Wordmark height={dense ? 28 : 31} />
          </div>
          <div data-fit="tagline" data-fit-max="18" data-fit-min="15" data-fit-lines="1" data-fit-lh="1.3" style={{ marginTop: 2, fontSize: 18, fontWeight: 600, lineHeight: 1.3, color: "rgba(255,255,255,0.55)" }}>
            {t('share.tagline')}
          </div>
        </div>
      </div>
    </div>
  );
});

export default ShareCardImage;
