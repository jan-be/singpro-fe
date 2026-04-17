import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import GapCorrector from "./GapCorrector";
import MyIcon from "../icon.svg?react";
import { Link } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { useLangPath } from "../GlobalConsts";

const BottomPartyIdBar = ({ partyId, songId, gapData, autoSkip, onToggleAutoSkip, isHost }) => {
  const { t } = useTranslation();
  const lp = useLangPath();
  const joinUrl = `https://${window.location.hostname}/join/${partyId}`;

  const [isFullscreen, setIsFullscreen] = useState(!!document.fullscreenElement);

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const handleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
    } else {
      document.documentElement.requestFullscreen?.();
    }
  };

  return (
    <nav className="relative z-30 bg-surface-light/90 backdrop-blur-sm border-b border-surface-lighter px-4 py-2">
      <div className="flex items-center justify-between gap-4 text-sm">
        {/* Left: Logo + hostname */}
        <Link to={lp('/')} className="flex items-center gap-2 text-white no-underline hover:text-neon-cyan transition-colors flex-shrink-0">
          <MyIcon width="16" height="16" />
          <span className="hidden sm:inline">{window.location.hostname}</span>
        </Link>

        {/* Center: Gap + Auto-skip + Fullscreen */}
        <div className="flex items-center gap-3">
          <GapCorrector songId={songId} gapData={gapData} />

          {/* Auto-skip toggle — host only */}
          {isHost && onToggleAutoSkip && (
            <button
              onClick={onToggleAutoSkip}
              title={t('bottom.autoSkipHint')}
              className={`px-3 py-1.5 text-xs rounded border transition-colors cursor-pointer ${
                autoSkip
                  ? 'bg-neon-green/10 text-neon-green border-neon-green hover:bg-neon-green/20'
                  : 'bg-surface text-gray-400 border-surface-lighter hover:text-white hover:border-gray-500'
              }`}
            >
              {autoSkip ? t('bottom.autoSkipOn') : t('bottom.autoSkipOff')}
            </button>
          )}

          <button
            onClick={handleFullscreen}
            title={isFullscreen ? t('bottom.exitFullscreen') : t('bottom.enterFullscreen')}
            className="p-1.5 rounded border border-neon-cyan/40 text-neon-cyan hover:bg-neon-cyan/10 hover:border-neon-cyan transition-colors cursor-pointer"
          >
            {isFullscreen ? (
              /* Compress / exit-fullscreen icon */
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="4 14 10 14 10 20" />
                <polyline points="20 10 14 10 14 4" />
                <line x1="10" y1="14" x2="3" y2="21" />
                <line x1="21" y1="3" x2="14" y2="10" />
              </svg>
            ) : (
              /* Expand / enter-fullscreen icon */
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 3 21 3 21 9" />
                <polyline points="9 21 3 21 3 15" />
                <line x1="21" y1="3" x2="14" y2="10" />
                <line x1="3" y1="21" x2="10" y2="14" />
              </svg>
            )}
          </button>
        </div>

        {/* Right: Party info */}
        {partyId && (
          <div className="flex items-center gap-3 flex-shrink-0">
            <div className="bg-white rounded p-0.5">
              <QRCodeSVG value={joinUrl} size={40} />
            </div>
            <div className="text-right">
              <div className="text-gray-400 text-xs">{t('bottom.partyCode')}</div>
              <div className="text-neon-cyan font-mono font-bold text-lg tracking-widest">{partyId}</div>
            </div>
          </div>
        )}
      </div>
    </nav>
  );
};

export default BottomPartyIdBar;
