import React from "react";
import GapCorrector from "./GapCorrector";
import MyIcon from "../icon.svg?react";
import { Link } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";

const BottomPartyIdBar = ({ partyId, songId, gapData }) => {
  const joinUrl = `https://${window.location.hostname}/join/${partyId}`;

  const handleFullscreen = () => {
    document.documentElement.requestFullscreen?.();
  };

  return (
    <nav className="bg-surface-light/90 backdrop-blur-sm border-b border-surface-lighter px-4 py-2">
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
            className="px-3 py-1.5 text-sm rounded border border-neon-cyan text-neon-cyan hover:bg-neon-cyan/10 transition-colors cursor-pointer"
          >
            Fullscreen
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
