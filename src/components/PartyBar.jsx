import React, { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import GapCorrector from "./GapCorrector";
import VolumeControl from "./VolumeControl";
import MicPanel from "./MicPanel";
import { markPopoverClosed } from "../logic/popoverGuard";
import { fullscreenSupported, isFullscreen, toggleFullscreen } from "../logic/fullscreen";
import MyIcon from "../icon.svg?react";
import { Link } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";

/** Detect actual smartphone (touch + small screen), not just narrow window */
const isSmartphone = () =>
  'ontouchstart' in window && /Mobi|Android|iPhone|iPod/i.test(navigator.userAgent);

const PartyBar = ({ partyId, songId, gapData, onGoToMenu, onEndParty, onLeaveParty, autoSkip, onToggleAutoSkip, isHost, isFixingTiming, onFixingTimingChange, volume, vocalsLevel, instrumentalLevel, onVolumeChange, onVocalsLevelChange, onInstrumentalLevelChange, hasStems, volumeTooltip, stemsHint, onDismissStemsHint,
  micActive, onJoinSinging, onLeaveSinging, micStatsRef, micDeviceId, onMicDeviceChange, ownColor, onColorChange, latencyMs,
  showVideo, onToggleVideo, videoHint, onDismissVideoHint, queueOpen, onToggleQueue, queueCount = 0, onFreeClick }) => {
  const { t } = useTranslation();
  const joinUrl = `https://${window.location.hostname}/join/${partyId}`;

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

  return (
    // No bar: the controls float over the video in two translucent pills. The
    // strip still catches the pointer (the player must never see it), and a
    // click on its empty part counts as free space: it pauses / resumes.
    <nav
      className="absolute top-0 inset-x-0 z-30 px-3 py-2"
      onClick={e => { if (onFreeClick && !e.target.closest('button, a, input, select, [role="slider"], [role="menu"]')) onFreeClick(); }}
    >
      <div className="flex items-center justify-between gap-2 sm:gap-4 text-sm">
        {/* Left: Logo + hostname (leads home, which also leaves the party) */}
        <Link to="/" onClick={() => onGoToMenu?.()} className="pointer-events-auto flex items-center gap-2 no-underline transition-colors flex-shrink-0 rounded-lg px-2 py-1 bg-surface-light/70 backdrop-blur-sm">
          <MyIcon width="16" height="16" />
          <span className="hidden sm:inline font-extrabold bg-gradient-to-r from-neon-cyan via-neon-purple to-neon-magenta bg-clip-text text-transparent leading-normal">singpro.app</span>
        </Link>

        {/* Right: microphone, volume, fullscreen, settings, then the party code */}
        <div className="pointer-events-auto flex items-center gap-2 sm:gap-3 rounded-lg px-2 py-1 bg-surface-light/70 backdrop-blur-sm">
          <MicPanel
            micActive={micActive}
            onJoin={onJoinSinging}
            onLeave={onLeaveSinging}
            statsRef={micStatsRef}
            deviceId={micDeviceId}
            onDeviceChange={onMicDeviceChange}
            ownColor={ownColor}
            onColorChange={onColorChange}
            latencyMs={latencyMs}
          />
          <VolumeControl
            volume={volume}
            vocalsLevel={vocalsLevel}
            instrumentalLevel={instrumentalLevel}
            onVolumeChange={onVolumeChange}
            onVocalsLevelChange={onVocalsLevelChange}
            onInstrumentalLevelChange={onInstrumentalLevelChange}
            hasStems={hasStems}
            volumeTooltip={volumeTooltip}
            stemsHint={stemsHint}
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
                className={`p-1.5 rounded border transition-colors cursor-pointer ${
                  showVideo
                    ? 'border-neon-cyan/50 text-neon-cyan hover:bg-neon-cyan/10 hover:border-neon-cyan'
                    : 'border-surface-lighter text-gray-400 hover:text-gray-300 hover:border-gray-500'
                }`}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="2" y="3" width="20" height="14" rx="2" />
                  <line x1="8" y1="21" x2="16" y2="21" />
                  <line x1="12" y1="17" x2="12" y2="21" />
                  {!showVideo && <line x1="4" y1="4" x2="20" y2="16" />}
                </svg>
              </button>
              {videoHint && showVideo && (
                <div
                  role="note"
                  className="fixed inset-x-4 top-14 sm:absolute sm:inset-x-auto sm:top-full sm:right-0 sm:mt-2 sm:w-64 bg-surface-light/95 backdrop-blur-sm border border-neon-cyan/50 rounded-lg p-3 shadow-lg z-50 text-xs text-gray-200"
                >
                  <div className="hidden sm:block absolute -top-1.5 right-3 w-3 h-3 rotate-45 bg-surface-light border-l border-t border-neon-cyan/50" aria-hidden="true" />
                  <p>{t('party.videoHint')}</p>
                  <div className="mt-2 text-right">
                    <button
                      type="button"
                      onClick={onDismissVideoHint}
                      className="px-2.5 py-1 rounded border border-neon-cyan/50 bg-neon-cyan/15 text-neon-cyan hover:bg-neon-cyan/25 transition-colors cursor-pointer"
                    >
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
              className="p-1.5 rounded border border-neon-cyan/40 text-neon-cyan hover:bg-neon-cyan/10 hover:border-neon-cyan transition-colors cursor-pointer"
            >
              {inFullscreen ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="4 14 10 14 10 20" />
                  <polyline points="20 10 14 10 14 4" />
                  <line x1="10" y1="14" x2="3" y2="21" />
                  <line x1="21" y1="3" x2="14" y2="10" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
              className={`p-1.5 rounded border transition-colors cursor-pointer ${
                menuOpen || isFixingTiming
                  ? 'border-neon-purple/60 text-neon-purple bg-neon-purple/10'
                  : 'border-surface-lighter text-gray-400 hover:text-white hover:border-gray-500'
              }`}
              title={t('bottom.settings')}
              aria-expanded={menuOpen}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
              </svg>
            </button>
            {menuOpen && (
              <div className="absolute top-full right-0 mt-2 bg-surface-light border border-surface-lighter rounded-lg shadow-xl z-50 min-w-56 overflow-hidden">
                {isHost && onToggleAutoSkip && (
                  <button
                    onClick={onToggleAutoSkip}
                    title={t('bottom.autoSkipHint')}
                    role="menuitemcheckbox"
                    aria-checked={!!autoSkip}
                    className={`w-full text-left px-4 py-2.5 text-sm transition-colors cursor-pointer flex items-center gap-2 ${
                      autoSkip
                        ? 'text-neon-green bg-neon-green/10 hover:bg-neon-green/15'
                        : 'text-gray-300 hover:bg-surface-lighter hover:text-white'
                    }`}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true">
                      <polygon points="13,6 23,12 13,18" />
                      <polygon points="2,6 12,12 2,18" />
                    </svg>
                    {autoSkip ? t('bottom.autoSkipOn') : t('bottom.autoSkipOff')}
                  </button>
                )}
                <button
                  onClick={() => { onFixingTimingChange(!isFixingTiming); setMenuOpen(false); }}
                  className={`w-full text-left px-4 py-2.5 text-sm transition-colors cursor-pointer flex items-center gap-2 ${
                    isFixingTiming
                      ? 'text-neon-purple bg-neon-purple/10'
                      : 'text-gray-300 hover:bg-surface-lighter hover:text-white'
                  }`}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                  {t('gap.fixTiming')}
                </button>
                <button
                  onClick={() => { setMenuOpen(false); (isHost ? onEndParty : onLeaveParty)?.(); }}
                  className="w-full text-left px-4 py-2.5 text-sm transition-colors cursor-pointer flex items-center gap-2 text-red-400 hover:bg-red-500/10 border-t border-surface-lighter"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                    <polyline points="16 17 21 12 16 7" />
                    <line x1="21" y1="12" x2="9" y2="12" />
                  </svg>
                  {isHost ? t('party.endParty') : t('party.leaveParty')}
                </button>
              </div>
            )}
          </div>

          {/* Queue + similar songs drawer */}
          {onToggleQueue && (
            <button
              type="button"
              data-queue-toggle
              onClick={onToggleQueue}
              title={t('queue.title')}
              aria-expanded={!!queueOpen}
              className={`relative flex items-center gap-1.5 px-2.5 py-1.5 rounded border text-xs font-semibold transition-colors cursor-pointer ${
                queueOpen
                  ? 'border-neon-cyan/60 text-neon-cyan bg-neon-cyan/10'
                  : 'border-neon-cyan/40 text-neon-cyan hover:bg-neon-cyan/10 hover:border-neon-cyan'
              }`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="8" y1="6" x2="21" y2="6" />
                <line x1="8" y1="12" x2="21" y2="12" />
                <line x1="8" y1="18" x2="21" y2="18" />
                <line x1="3" y1="6" x2="3.01" y2="6" />
                <line x1="3" y1="12" x2="3.01" y2="12" />
                <line x1="3" y1="18" x2="3.01" y2="18" />
              </svg>
              <span>{t('queue.title')}</span>
              {queueCount > 0 && (
                <span className="min-w-4 h-4 px-1 rounded-full bg-neon-magenta text-[10px] font-bold text-white leading-4 text-center">{queueCount}</span>
              )}
            </button>
          )}

        {/* Party info — QR + code on desktop, share button on mobile */}
        {partyId && (
          <>
            {/* Desktop: QR + party code */}
            <div className="hidden sm:flex items-center gap-3 flex-shrink-0">
              <div className="relative" ref={!isPhone ? qrRef : undefined}>
                <button
                  onClick={() => setQrOpen(p => !p)}
                  className="bg-white rounded p-0.5 cursor-pointer hover:scale-110 transition-transform"
                  title="Enlarge QR code"
                >
                  <QRCodeSVG value={joinUrl} size={30} />
                </button>
                {qrOpen && (
                  <div className="absolute top-full right-0 mt-2 bg-white rounded-xl p-4 shadow-lg flex flex-col items-center gap-3 z-50" style={{ minWidth: 200 }}>
                    <QRCodeSVG value={joinUrl} size={160} />
                    <div className="text-gray-900 font-mono text-sm text-center break-all select-all leading-tight">{joinUrl}</div>
                    <button
                      onClick={() => { navigator.clipboard.writeText(joinUrl); }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-medium transition-colors cursor-pointer"
                    >
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="9" y="9" width="13" height="13" rx="2" />
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                      </svg>
                      Copy link
                    </button>
                  </div>
                )}
              </div>
              <div className="text-right">
                <div className="text-gray-400 text-[10px] leading-tight">{t('bottom.partyCode')}</div>
                <div className="text-neon-cyan font-mono font-bold text-base leading-tight tracking-widest">{partyId}</div>
              </div>
            </div>

            {/* Mobile: share button that opens QR popout */}
            <div className="sm:hidden relative flex-shrink-0" ref={isPhone ? qrRef : undefined}>
              <button
                onClick={() => setQrOpen(p => !p)}
                className="p-1.5 rounded border border-neon-cyan/40 text-neon-cyan hover:bg-neon-cyan/10 hover:border-neon-cyan transition-colors cursor-pointer"
                title={t('bottom.partyCode')}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                  <polyline points="16 6 12 2 8 6" />
                  <line x1="12" y1="2" x2="12" y2="15" />
                </svg>
              </button>
              {qrOpen && (
                <div className="absolute top-full right-0 mt-2 bg-white rounded-xl p-4 shadow-lg flex flex-col items-center gap-3 z-50" style={{ minWidth: 200 }}>
                  <QRCodeSVG value={joinUrl} size={160} />
                  <div className="text-gray-900 font-mono text-sm text-center break-all select-all leading-tight">{joinUrl}</div>
                  <button
                    onClick={() => { navigator.clipboard.writeText(joinUrl); }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-medium transition-colors cursor-pointer"
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="9" y="9" width="13" height="13" rx="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                    Copy link
                  </button>
                </div>
              )}
            </div>
          </>
        )}
        </div>
      </div>

      {/* GapCorrector popover — rendered outside the flex so it doesn't affect layout.
          Only mounts when timing correction is active; uses controlled isOpen. */}
      {isFixingTiming && (
        <div className="pointer-events-auto">
          <GapCorrector songId={songId} gapData={gapData} isOpen={isFixingTiming} onOpenChange={onFixingTimingChange} />
        </div>
      )}
    </nav>
  );
};

export default PartyBar;
