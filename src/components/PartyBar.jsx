import React, { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import GapCorrector from "./GapCorrector";
import ReportSongDialog from "./ReportSongDialog";
import { useAuth } from "../logic/AuthContext";
import VolumeControl from "./VolumeControl";
import MicPanel from "./MicPanel";
import { PopOutIcon } from "./Icons";
import QueueChartBadge from "./QueueChartBadge";
import { markPopoverClosed } from "../logic/popoverGuard";
import { fullscreenSupported, isFullscreen, toggleFullscreen } from "../logic/fullscreen";
import AppIcon from "./AppIcon";
import Wordmark from "./Wordmark";
import { Link } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { partyJoinUrl } from "../logic/referrer";

/** Detect actual smartphone (touch + small screen), not just narrow window */
const isSmartphone = () =>
  'ontouchstart' in window && /Mobi|Android|iPhone|iPod/i.test(navigator.userAgent);

const PartyBar = ({ partyId, songId, gapData, onGoToMenu, onEndParty, onLeaveParty, autoSkip, onToggleAutoSkip, isHost, isFixingTiming, onFixingTimingChange, volume, restoreVolume, vocalsLevel, instrumentalLevel, onVolumeChange, onVocalsLevelChange, onInstrumentalLevelChange, hasStems, volumeTooltip, stemsHint, onDismissStemsHint,
  micActive, micPhase, micError, onJoinSinging, onLeaveSinging, micStatsRef, micDeviceId, onMicDeviceChange, onMicPanelOpenChange, ownColor, onColorChange, latency,
  showVideo, onToggleVideo, videoHint, onDismissVideoHint, queueOpen, queuePoppedOut, onToggleQueue, queueCount = 0, onFreeClick,
  getReportContext }) => {
  const { t } = useTranslation();
  // Fixing a song's timing is the admins' job; everyone else reports what is wrong
  const { user } = useAuth();
  const canFixTiming = !!user?.isAdmin;
  const hasSong = !!songId && songId !== 'none';
  const [reportOpen, setReportOpen] = useState(false);
  // The vocal-track hint waits while the mic panel, the menu or the queue is open (it would cover them)
  const [micPanelOpen, setMicPanelOpen] = useState(false);
  const handleMicPanelOpenChange = useCallback((open) => {
    setMicPanelOpen(open);
    onMicPanelOpenChange?.(open);
  }, [onMicPanelOpenChange]);
  // The QR code and the copied link are tagged so an arrival by them is told
  // apart from a typed address (logic/referrer.js); the URL shown stays plain
  const joinUrl = partyJoinUrl(partyId);
  const qrUrl = partyJoinUrl(partyId, 'qr');
  const linkUrl = partyJoinUrl(partyId, 'link');

  const [qrOpen, setQrOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const qrRef = useRef(null);
  const menuRef = useRef(null);
  const [isPhone] = useState(isSmartphone);

  // Browser fullscreen: only hides the browser and OS chrome, the page keeps
  // its layout (with a little more room). Hidden where the API is missing (iOS).
  // Same toggle the sing page's double-click uses, so the icon and the
  // gesture can never disagree about which spelling of the API to call.
  const [supported] = useState(fullscreenSupported);
  const [inFullscreen, setInFullscreen] = useState(isFullscreen);
  useEffect(() => {
    const onChange = () => setInFullscreen(isFullscreen());
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange);
    };
  }, []);

  useEffect(() => {
    if (!qrOpen) return;
    const handleClick = e => { if (qrRef.current && !qrRef.current.contains(e.target)) { setQrOpen(false); markPopoverClosed(); } };
    document.addEventListener("pointerdown", handleClick);
    return () => document.removeEventListener("pointerdown", handleClick);
  }, [qrOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const handleClick = e => { if (menuRef.current && !menuRef.current.contains(e.target)) { setMenuOpen(false); markPopoverClosed(); } };
    document.addEventListener("pointerdown", handleClick);
    return () => document.removeEventListener("pointerdown", handleClick);
  }, [menuOpen]);

  const qrCard = (
    <div className="absolute top-full right-0 mt-2.5 bg-white rounded-2xl p-5 shadow-[0_24px_60px_-16px_rgba(0,0,0,0.85)] flex flex-col items-center gap-3 z-50" style={{ minWidth: 220 }}>
      <QRCodeSVG value={qrUrl} size={168} />
      <div className="text-gray-900 font-mono text-sm text-center break-all select-all leading-tight">{joinUrl}</div>
      <button
        onClick={() => { navigator.clipboard.writeText(linkUrl); }}
        className="btn btn-sm bg-ink text-white hover:bg-black"
      >
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="9" y="9" width="13" height="13" rx="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
        Copy link
      </button>
    </div>
  );

  return (
    // No bar: the controls float over the video in two capsules, solid tints
    // with no backdrop blur (they sit over the playing video). The strip still
    // catches the pointer (the player must never see it), and a click on its
    // empty part counts as free space: it pauses / resumes. Not one in the
    // controls' capsule, though: a near miss between its buttons, or a click
    // on the text or padding of a popover opened from it (they are inside),
    // paused the song.
    <nav
      className="absolute top-0 inset-x-0 z-30 px-2.5 py-2.5 sm:px-4"
      onClick={e => { if (onFreeClick && !e.target.closest('a, .capsule')) onFreeClick(); }}
    >
      <div className="flex items-center justify-between gap-2 sm:gap-4 text-sm">
        {/* Left: the logo (leads home, which also leaves the party) */}
        <Link to="/" onClick={() => onGoToMenu?.()} className="pointer-events-auto block no-underline flex-shrink-0 rounded-[22%] sm:rounded-full">
          {/* Phones: the icon tile on its own, as tall as the capsule */}
          <AppIcon width="46" height="46" className="sm:hidden block" />
          {/* No negative margin: the capsule must hold the mic above and the g below */}
          <span className="capsule hidden sm:flex px-3">
            <Wordmark height={32} />
          </span>
        </Link>

        {/* Right: microphone, volume, video, fullscreen, settings | queue | the party code */}
        <div className="pointer-events-auto capsule min-w-0">
          <MicPanel
            micActive={micActive}
            micPhase={micPhase}
            micError={micError}
            onJoin={onJoinSinging}
            onLeave={onLeaveSinging}
            statsRef={micStatsRef}
            deviceId={micDeviceId}
            onDeviceChange={onMicDeviceChange}
            ownColor={ownColor}
            onColorChange={onColorChange}
            latency={latency}
            onOpenChange={handleMicPanelOpenChange}
          />
          <VolumeControl
            volume={volume}
            restoreVolume={restoreVolume}
            vocalsLevel={vocalsLevel}
            instrumentalLevel={instrumentalLevel}
            onVolumeChange={onVolumeChange}
            onVocalsLevelChange={onVocalsLevelChange}
            onInstrumentalLevelChange={onInstrumentalLevelChange}
            hasStems={hasStems}
            volumeTooltip={volumeTooltip}
            stemsHint={stemsHint && !micPanelOpen && !menuOpen && !queueOpen}
            onDismissStemsHint={onDismissStemsHint}
          />

          {/* Joiners: show / hide the video (off saves mobile data while
              looking at the big screen); a one-time callout points it out */}
          {onToggleVideo && (
            <div className="relative">
              <button
                type="button"
                onClick={() => { if (videoHint) onDismissVideoHint?.(); onToggleVideo(); }}
                aria-pressed={!!showVideo}
                title={showVideo ? t('party.hideVideo') : t('party.showVideo')}
                className="btn-icon"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="2" y="3" width="20" height="14" rx="2.5" />
                  <line x1="8" y1="21" x2="16" y2="21" />
                  <line x1="12" y1="17" x2="12" y2="21" />
                  {!showVideo && <line x1="4" y1="4" x2="20" y2="16" />}
                </svg>
              </button>
              {videoHint && showVideo && (
                <div
                  role="note"
                  className="pop fixed inset-x-3 top-[4.25rem] sm:absolute sm:inset-x-auto sm:top-full sm:right-0 sm:mt-2.5 sm:w-72 p-4 z-50 text-sm"
                >
                  <div className="hidden sm:block absolute -top-1.5 right-3.5 w-3 h-3 rotate-45 bg-[#251e48] border-l border-t border-white/[0.14]" aria-hidden="true" />
                  <p className="text-white/85 leading-snug">{t('party.videoHint')}</p>
                  <div className="mt-3 flex justify-end">
                    <button type="button" onClick={onDismissVideoHint} className="btn btn-sm btn-primary">
                      {t('volume.gotIt')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Browser fullscreen */}
          {supported && (
            <button
              onClick={toggleFullscreen}
              title={inFullscreen ? t('bottom.exitFullscreen') : t('bottom.enterFullscreen')}
              aria-pressed={inFullscreen}
              className="btn-icon max-[380px]:hidden"
            >
              {inFullscreen ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="4 14 10 14 10 20" />
                  <polyline points="20 10 14 10 14 4" />
                  <line x1="10" y1="14" x2="3" y2="21" />
                  <line x1="21" y1="3" x2="14" y2="10" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="15 3 21 3 21 9" />
                  <polyline points="9 21 3 21 3 15" />
                  <line x1="21" y1="3" x2="14" y2="10" />
                  <line x1="3" y1="21" x2="10" y2="14" />
                </svg>
              )}
            </button>
          )}

          {/* Settings: auto-skip (host) + fix timing */}
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen(p => !p)}
              className={`btn-icon ${isFixingTiming ? 'is-on text-neon-purple' : ''}`}
              title={t('bottom.settings')}
              aria-expanded={menuOpen}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
              </svg>
            </button>
            {menuOpen && (
              <div className="pop absolute top-full right-0 mt-2.5 p-1.5 z-50 min-w-60">
                {isHost && onToggleAutoSkip && (
                  <button
                    onClick={onToggleAutoSkip}
                    title={t('bottom.autoSkipHint')}
                    role="menuitemcheckbox"
                    aria-checked={!!autoSkip}
                    className={`menu-item ${autoSkip ? 'text-neon-green hover:text-neon-green' : ''}`}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true">
                      <polygon points="13,6 23,12 13,18" />
                      <polygon points="2,6 12,12 2,18" />
                    </svg>
                    {autoSkip ? t('bottom.autoSkipOn') : t('bottom.autoSkipOff')}
                  </button>
                )}
                {canFixTiming && (
                  <button
                    onClick={() => { onFixingTimingChange(!isFixingTiming); setMenuOpen(false); }}
                    className={`menu-item ${isFixingTiming ? 'text-neon-purple hover:text-neon-purple' : ''}`}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="12" cy="12" r="10" />
                      <polyline points="12 6 12 12 16 14" />
                    </svg>
                    {t('gap.fixTiming')}
                  </button>
                )}
                {hasSong && (
                  <button
                    onClick={() => { setReportOpen(true); setMenuOpen(false); }}
                    className="menu-item"
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M4 22V4a1 1 0 0 1 1-1h11l-2 4 2 4H5" />
                    </svg>
                    {t('report.menu')}
                  </button>
                )}
                <div className="my-1 h-px bg-white/8" aria-hidden="true" />
                <button
                  onClick={() => { setMenuOpen(false); (isHost ? onEndParty : onLeaveParty)?.(); }}
                  className="menu-item text-red-400 hover:text-red-300 hover:bg-red-500/10"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                    <polyline points="16 17 21 12 16 7" />
                    <line x1="21" y1="12" x2="9" y2="12" />
                  </svg>
                  {isHost ? t('party.endParty') : t('party.leaveParty')}
                </button>
              </div>
            )}
          </div>

          {/* Queue + similar songs drawer; while the queue has a window of
              its own, the button brings that window to the front */}
          {onToggleQueue && (
            <>
              <span className="capsule-divider" aria-hidden="true" />
              <button
                type="button"
                data-queue-toggle
                onClick={onToggleQueue}
                title={queuePoppedOut ? t('queue.poppedOut') : t('queue.title')}
                aria-expanded={queuePoppedOut ? undefined : !!queueOpen}
                className={`btn btn-sm relative h-9 px-3 gap-1.5 ${queueOpen ? 'fill-hot' : 'bg-white/12 text-white hover:bg-white/20'}`}
              >
                {queuePoppedOut ? <PopOutIcon size={15} /> : (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <line x1="8" y1="6" x2="21" y2="6" />
                    <line x1="8" y1="12" x2="21" y2="12" />
                    <line x1="8" y1="18" x2="21" y2="18" />
                    <line x1="3" y1="6" x2="3.01" y2="6" />
                    <line x1="3" y1="12" x2="3.01" y2="12" />
                    <line x1="3" y1="18" x2="3.01" y2="18" />
                  </svg>
                )}
                <span className="max-[400px]:hidden">{t('queue.title')}</span>
                {queueCount > 0 && (
                  <span className="min-w-[1.125rem] h-[1.125rem] px-1 rounded-full bg-neon-magenta text-[10px] font-bold text-white leading-[1.125rem] text-center tabular-nums">{queueCount}</span>
                )}
                {/* songs of the queue still being charted, and a word when one is ready */}
                <QueueChartBadge />
              </button>
            </>
          )}

          {/* Party info: QR + code on desktop, a share button on phones */}
          {partyId && (
            <>
              <span className="capsule-divider hidden sm:block" aria-hidden="true" />
              <div className="hidden sm:flex items-center gap-2.5 pl-1 pr-2.5 flex-shrink-0">
                <div className="relative" ref={!isPhone ? qrRef : undefined}>
                  <button
                    onClick={() => setQrOpen(p => !p)}
                    className="block bg-white rounded-lg p-[3px] cursor-pointer hover:scale-105 active:scale-95 transition-transform"
                    title="Enlarge QR code"
                  >
                    <QRCodeSVG value={qrUrl} size={26} />
                  </button>
                  {qrOpen && qrCard}
                </div>
                <div className="text-left leading-none">
                  <div className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-white/45">{t('bottom.partyCode')}</div>
                  <div className="mt-1 text-neon-cyan font-mono font-semibold text-[15px] tracking-[0.2em]">{partyId}</div>
                </div>
              </div>

              <div className="sm:hidden relative flex-shrink-0" ref={isPhone ? qrRef : undefined}>
                <button
                  onClick={() => setQrOpen(p => !p)}
                  aria-expanded={qrOpen}
                  className="btn-icon"
                  title={t('bottom.partyCode')}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                    <polyline points="16 6 12 2 8 6" />
                    <line x1="12" y1="2" x2="12" y2="15" />
                  </svg>
                </button>
                {qrOpen && qrCard}
              </div>
            </>
          )}
        </div>
      </div>

      {/* GapCorrector popover — rendered outside the flex so it doesn't affect layout.
          Only mounts when timing correction is active; uses controlled isOpen. */}
      {isFixingTiming && canFixTiming && (
        <div className="pointer-events-auto">
          <GapCorrector songId={songId} gapData={gapData} isOpen={isFixingTiming} onOpenChange={onFixingTimingChange} />
        </div>
      )}
      {reportOpen && hasSong && (
        <div className="pointer-events-auto">
          <ReportSongDialog songId={songId} isOpen={reportOpen} onClose={() => setReportOpen(false)} getContext={getReportContext} />
        </div>
      )}
    </nav>
  );
};

// Memoised: the party page re-renders on queue, score and player messages,
// and the bar only needs to when one of its own props changes
export default React.memo(PartyBar);
