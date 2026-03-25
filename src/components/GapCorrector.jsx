import React, { useRef, useState } from "react";
import { apiUrl } from "../GlobalConsts";

const GapCorrector = ({ songId, gapData }) => {
  const lastTimeRef = useRef(performance.now());
  const [sliderValue, setSliderValue] = useState(0);
  const [isOpen, setIsOpen] = useState(false);

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
    if (gapData.gap !== undefined && gapData.gap !== null) {
      const newValue = Math.max(0, gapData.gap + ((time - lastTimeRef.current) * 10 * (value * Math.abs(value))));
      gapData.setGap(newValue);
    }
    lastTimeRef.current = time;
    setSliderValue(value);
  };

  return (
    <div className="relative inline-block">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="px-3 py-1.5 text-sm rounded border border-neon-purple text-neon-purple hover:bg-neon-purple/10 transition-colors cursor-pointer"
      >
        Fix timing
      </button>

      {isOpen && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />

          {/* Popover */}
          <div className="absolute z-50 top-full mt-2 left-1/2 -translate-x-1/2 bg-surface-light border border-surface-lighter rounded-lg shadow-2xl p-4 min-w-[240px]">
            <div className="flex flex-col items-center gap-3">
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
                  value={Math.floor(gapData.gap ?? 0)}
                  onChange={(e) => gapData.setGap(Number(e.target.value))}
                  className="w-24 px-2 py-1 rounded bg-surface border border-surface-lighter text-white text-center focus:outline-none focus:border-neon-purple"
                />
                <span className="text-gray-400 text-sm">ms</span>
              </div>

              <button
                onClick={() => { pushNewGap(Math.floor(gapData.gap)); }}
                className="px-4 py-1.5 text-sm rounded border border-neon-purple text-neon-purple hover:bg-neon-purple/10 transition-colors cursor-pointer"
              >
                Submit
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default GapCorrector;
