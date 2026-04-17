import React, { useRef, useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { apiUrl } from "../GlobalConsts";

const GapCorrector = ({ songId, gapData, isOpen: controlledIsOpen, onOpenChange }) => {
  const { t } = useTranslation();
  const lastTimeRef = useRef(performance.now());
  const [sliderValue, setSliderValue] = useState(0);
  // Support both controlled (parent owns isOpen) and uncontrolled usage.
  const [uncontrolledIsOpen, setUncontrolledIsOpen] = useState(false);
  const isOpen = controlledIsOpen !== undefined ? controlledIsOpen : uncontrolledIsOpen;
  const setIsOpen = (v) => {
    if (onOpenChange) onOpenChange(v);
    if (controlledIsOpen === undefined) setUncontrolledIsOpen(v);
  };
  // Local gap state — syncs from gapData.gap when popover opens,
  // writes back to gapData.setGap on every change for live preview.
  const [localGap, setLocalGap] = useState(Number(gapData.gap) || 0);

  // Sync local gap from props when gapData.gap changes externally (e.g. server load,
  // MusicBars drag). Also re-sync whenever the popover is opened so we always show
  // the latest authoritative value. Coerce to number because the API may return strings.
  useEffect(() => {
    const numGap = Number(gapData.gap);
    if (Number.isFinite(numGap)) {
      setLocalGap(numGap);
    }
  }, [gapData.gap, isOpen]);

  const updateGap = (newGap) => {
    const clamped = Math.max(0, newGap);
    setLocalGap(clamped);
    gapData.setGap(clamped);
  };

  const pushNewGap = (gap) => {
    fetch(`${apiUrl}/songs/${songId}`, {
      method: "PATCH",
      body: JSON.stringify({ gap }),
      headers: { "Content-Type": "application/json" },
    });
  };

  const handleSliderChange = (e) => {
    const value = parseFloat(e.target.value);
    const time = performance.now();
    const dt = time - lastTimeRef.current;
    lastTimeRef.current = time;
    setSliderValue(value);
    // Rate-based adjustment: gap changes proportional to slider position and elapsed time
    const delta = dt * 10 * (value * Math.abs(value));
    updateGap(localGap + delta);
  };

  return (
    <div className="relative inline-block">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`px-3 py-1.5 text-sm rounded border transition-colors cursor-pointer ${
          isOpen
            ? 'border-neon-purple bg-neon-purple/20 text-neon-purple'
            : 'border-neon-purple text-neon-purple hover:bg-neon-purple/10'
        }`}
      >
        {t('gap.fixTiming')}
      </button>

      {isOpen && (
        <>
          {/* Backdrop — fixed fullscreen to catch clicks */}
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />

          {/* Popover — fixed center of screen so it's always visible */}
          <div className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-surface-light border border-surface-lighter rounded-lg shadow-2xl p-5 min-w-[280px]">
            <div className="text-center text-gray-400 text-xs uppercase tracking-wider mb-3">{t('gap.gapCorrection')}</div>

            <div className="flex flex-col items-center gap-4">
              <input
                type="range"
                min={-1}
                max={1}
                step={0.00001}
                value={sliderValue}
                onChange={handleSliderChange}
                onMouseUp={() => setSliderValue(0)}
                onTouchEnd={() => setSliderValue(0)}
                className="w-full accent-neon-purple"
              />

              <div className="flex items-center gap-2 text-white">
                <input
                  type="number"
                  value={Math.floor(Number(localGap)) || 0}
                  onChange={(e) => updateGap(Number(e.target.value))}
                  className="w-24 px-2 py-1.5 rounded bg-surface border border-surface-lighter text-white text-center focus:outline-none focus:border-neon-purple"
                />
                <span className="text-gray-400 text-sm">{t('gap.ms')}</span>
              </div>

              <button
                onClick={() => {
                  pushNewGap(Math.floor(localGap));
                  setIsOpen(false);
                }}
                className="w-full px-4 py-2 text-sm rounded bg-neon-purple/20 border border-neon-purple text-neon-purple hover:bg-neon-purple/30 transition-colors cursor-pointer font-semibold"
              >
                {t('gap.save')}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default GapCorrector;
