import React, { useState } from "react";

/**
 * PingIndicator — three growing signal bars that show network latency.
 *
 * Color tiers:
 *   < 50 ms  → green   (all 3 bars lit)
 *   < 100 ms → yellow  (2 bars lit)
 *   ≥ 100 ms → red     (1 bar lit)
 *
 * On hover, shows the exact ping in ms as a tooltip.
 */
const PingIndicator = ({ latencyMs, size = 14 }) => {
  const [hovered, setHovered] = useState(false);

  // Determine tier
  let color, barsLit;
  if (latencyMs === undefined || latencyMs === null) {
    color = "#6b7280"; // gray — no data yet
    barsLit = 0;
  } else if (latencyMs < 50) {
    color = "#4ade80"; // green
    barsLit = 3;
  } else if (latencyMs < 100) {
    color = "#facc15"; // yellow
    barsLit = 2;
  } else {
    color = "#f87171"; // red
    barsLit = 1;
  }

  const dimColor = "rgba(255,255,255,0.15)";

  // Bar dimensions (relative to size)
  const barWidth = size * 0.22;
  const gap = size * 0.1;
  const totalWidth = barWidth * 3 + gap * 2;
  const heights = [size * 0.4, size * 0.65, size * 0.9];

  return (
    <span
      className="relative inline-flex items-end cursor-default select-none"
      style={{ width: totalWidth, height: size }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            display: "inline-block",
            width: barWidth,
            height: heights[i],
            marginLeft: i > 0 ? gap : 0,
            borderRadius: 2,
            backgroundColor: i < barsLit ? color : dimColor,
            transition: "background-color 0.4s ease",
            alignSelf: "flex-end",
          }}
        />
      ))}

      {hovered && (
        <span
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 rounded text-xs font-mono whitespace-nowrap z-50 pointer-events-none"
          style={{
            backgroundColor: "rgba(0,0,0,0.85)",
            color: color,
            border: `1px solid ${color}40`,
          }}
        >
          {latencyMs !== undefined && latencyMs !== null
            ? `${Math.round(latencyMs)} ms`
            : "? ms"}
        </span>
      )}
    </span>
  );
};

export default PingIndicator;
