import React, { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import GapCorrector from "./GapCorrector";
import VolumeControl from "./VolumeControl";
import MyIcon from "../icon.svg?react";
import { Link } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { useLangPath } from "../GlobalConsts";

/** Detect actual smartphone (touch + small screen), not just narrow window */
const isSmartphone = () =>
  'ontouchstart' in window && /Mobi|Android|iPhone|iPod/i.test(navigator.userAgent);

const PartyBar = ({ partyId, songId, gapData, autoSkip, onToggleAutoSkip, isHost, isFixingTiming, onFixingTimingChange, musicVolume, vocalsVolume, onMusicVolumeChange, onVocalsVolumeChange, hasStems, volumeTooltip }) => {
  const { t } = useTranslation();
  const lp = useLangPath();
  const joinUrl = `https://${window.location.hostname}/join/${partyId}`;

  const [isFullscreen, setIsFullscreen] = useState(!!document.fullscreenElement);
  const [qrOpen, setQrOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const qrRef = useRef(null);
  const menuRef = useRef(null);
  const [isPhone] = useState(isSmartphone);

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => {
    if (!qrOpen) return;
    const handleClick = e => { if (qrRef.current && !qrRef.current.contains(e.target)) setQrOpen(false); };
    document.addEventListener("pointerdown", handleClick);
    return () => document.removeEventListener("pointerdown", handleClick);
  }, [qrOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const handleClick = e => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false); };
    document.addEventListener("pointerdown", handleClick);
    return () => document.removeEventListener("pointerdown", handleClick);
  }, [menuOpen]);

  const handleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
    } else {
      document.documentElement.requestFullscreen?.();
    }
  };

  return (
    <nav className="relative z-30 bg-surface-light/90 backdrop-blur-sm border-b border-surface-lighter px-4 py-2">
      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-neon-purple/40 to-transparent" />
      <div className="flex items-center justify-between gap-2 sm:gap-4 text-sm">
        {/* Left: Logo + hostname */}
        <Link to={lp('/')} className="flex items-center gap-2 no-underline transition-colors flex-shrink-0">
          <MyIcon width="16" height="16" />
          <span className="hidden sm:inline font-extrabold bg-gradient-to-r from-neon-cyan via-neon-purple to-neon-magenta bg-clip-text text-transparent leading-normal">singpro.app</span>
        </Link>

        {/* Center: Volume + Auto-skip + Fullscreen + Three-dots menu */}
        <div className="flex items-center gap-2 sm:gap-3">
          <VolumeControl
            musicVolume={musicVolume}
            vocalsVolume={vocalsVolume}
            onMusicChange={onMusicVolumeChange}
            onVocalsChange={onVocalsVolumeChange}
            hasStems={hasStems}
            volumeTooltip={volumeTooltip}
          />

          {/* Auto-skip toggle — host only */}
          {isHost && onToggleAutoSkip && (
            <button
              onClick={onToggleAutoSkip}
              title={t('bottom.autoSkipHint')}
              className={`flex items-center gap-1.5 px-2 sm:px-3 py-1.5 text-xs rounded border transition-colors cursor-pointer ${
                autoSkip
                  ? 'bg-neon-green/10 text-neon-green border-neon-green hover:bg-neon-green/20'
                  : 'bg-surface text-gray-400 border-surface-lighter hover:text-white hover:border-gray-500'
              }`}
            >
              {/* Fast-forward icon */}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                <polygon points="13,6 23,12 13,18" />
                <polygon points="2,6 12,12 2,18" />
              </svg>
              <span className="hidden sm:inline">{autoSkip ? t('bottom.autoSkipOn') : t('bottom.autoSkipOff')}</span>
            </button>
          )}

          {/* Fullscreen button — hidden on actual smartphones */}
          {!isPhone && (
            <button
              onClick={handleFullscreen}
              title={isFullscreen ? t('bottom.exitFullscreen') : t('bottom.enterFullscreen')}
              className="p-1.5 rounded border border-neon-cyan/40 text-neon-cyan hover:bg-neon-cyan/10 hover:border-neon-cyan transition-colors cursor-pointer"
            >
              {isFullscreen ? (
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

          {/* Three-dots option menu */}
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen(p => !p)}
              className="p-1.5 rounded border border-surface-lighter text-gray-400 hover:text-white hover:border-gray-500 transition-colors cursor-pointer"
              title="Options"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="5" r="2" />
                <circle cx="12" cy="12" r="2" />
                <circle cx="12" cy="19" r="2" />
              </svg>
            </button>
            {menuOpen && (
              <div className="absolute top-full right-0 mt-2 bg-surface-light border border-surface-lighter rounded-lg shadow-xl z-50 min-w-48 overflow-hidden">
                <GapCorrector songId={songId} gapData={gapData} isOpen={isFixingTiming} onOpenChange={(v) => { onFixingTimingChange(v); if (v) setMenuOpen(false); }} asMenuItem />
              </div>
            )}
          </div>
        </div>

        {/* Right: Party info — full on desktop, share button on mobile */}
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
                  <QRCodeSVG value={joinUrl} size={40} />
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
                <div className="text-gray-400 text-xs">{t('bottom.partyCode')}</div>
                <div className="text-neon-cyan font-mono font-bold text-lg tracking-widest">{partyId}</div>
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
    </nav>
  );
};

export default PartyBar;
