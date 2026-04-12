import React, { useState, useEffect } from "react";
import GapCorrector from "./GapCorrector";
import MyIcon from "../icon.svg?react";
import { Link } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";

const BottomPartyIdBar = ({ partyId, songId, gapData }) => {
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
        <Link to="/" className="flex items-center gap-2 text-white no-underline hover:text-neon-cyan transition-colors flex-shrink-0">
          <MyIcon width="16" height="16" />
          <span className="hidden sm:inline">{window.location.hostname}</span>
        </Link>

        {/* Center: Gap + Fullscreen */}
        <div className="flex items-center gap-3">
          <GapCorrector songId={songId} gapData={gapData} />
          <button
            onClick={handleFullscreen}
            title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
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
              <div className="text-gray-400 text-xs">Party Code</div>
              <div className="text-neon-cyan font-mono font-bold text-lg tracking-widest">{partyId}</div>
            </div>
          </div>
        )}
      </div>
    </nav>
  );
};

export default BottomPartyIdBar;
