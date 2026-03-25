import React, { useCallback } from "react";
import GapCorrector from "./GapCorrector";
import MyIcon from "../icon.svg?react";
import { Link } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { apiUrl } from "../GlobalConsts";

const BottomPartyIdBar = ({ partyId, setPartyId, songId, gapData }) => {
  const joinUrl = `https://${window.location.hostname}/join/${partyId}`;

  const handleStartParty = useCallback(async () => {
    try {
      const resp = await fetch(`${apiUrl}/parties`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner: "Host" }),
      });
      const data = await resp.json();
      const newPartyId = data.partyId ?? data.data?.partyId;
      if (newPartyId) setPartyId(newPartyId);
    } catch (e) {
      console.error("Failed to create party", e);
    }
  }, [setPartyId]);

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

        {/* Right: Party info or Start Party */}
        {partyId ? (
          <div className="flex items-center gap-3 flex-shrink-0">
            <div className="bg-white rounded p-0.5">
              <QRCodeSVG value={joinUrl} size={40} />
            </div>
            <div className="text-right">
              <div className="text-gray-400 text-xs">Party Code</div>
              <div className="text-neon-cyan font-mono font-bold text-lg tracking-widest">{partyId}</div>
            </div>
          </div>
        ) : (
          <button
            onClick={handleStartParty}
            className="px-4 py-1.5 text-sm rounded bg-gradient-to-r from-neon-cyan to-neon-purple text-white font-bold hover:shadow-[0_0_15px_rgba(0,229,255,0.3)] transition-all cursor-pointer flex-shrink-0"
          >
            Start Party
          </button>
        )}
      </div>
    </nav>
  );
};

export default BottomPartyIdBar;
