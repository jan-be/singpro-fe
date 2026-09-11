import React from "react";
import { useTranslation } from "react-i18next";
import PingIndicator from "./PingIndicator";
import { PLAYER_COLOR_PALETTE, playerHue, hueToCss } from "../logic/playerColor";

/**
 * Live scores of everyone singing.
 *
 * Two layouts: a vertical list for the sidebar on large screens, and a
 * single row of chips that scrolls sideways on phones, where a dozen
 * players must not push the note highway off the screen. The player's own
 * colour dot opens the colour picker in both.
 */
const Scoreboard = ({
  scores, playerColors, currentUserName, latencies = {},
  ownColor, colorPickerOpen, onToggleColorPicker, onColorChange, pickerRef,
  compact = false,
}) => {
  const { t } = useTranslation();
  const entries = Object.entries(scores ?? {});
  if (entries.length === 0) return null;

  const picker = (
    <div className={`flex flex-wrap gap-1.5 py-1 ${compact ? 'pt-2' : 'pl-5'}`}>
      {PLAYER_COLOR_PALETTE.map(h => (
        <button
          key={h}
          onClick={() => onColorChange(h)}
          className={`w-4 h-4 rounded-full border-2 transition-transform cursor-pointer ${
            ownColor === h ? 'border-white scale-125' : 'border-transparent hover:scale-110'
          }`}
          style={{ background: hueToCss(h) }}
          title={t('party.yourColor')}
        />
      ))}
    </div>
  );

  const dot = (name, isMe, dotColor) => isMe ? (
    <button
      type="button"
      onClick={onToggleColorPicker}
      className="w-2.5 h-2.5 rounded-full flex-shrink-0 cursor-pointer hover:scale-125 transition-transform border border-white/40"
      style={{ background: dotColor }}
      title={t('party.yourColor')}
    />
  ) : (
    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: dotColor }} />
  );

  if (compact) {
    return (
      <div ref={pickerRef} className="bg-surface-light/80 rounded-lg px-2 py-1.5 backdrop-blur-sm">
        <div className="flex gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {entries.map(([name, { score, cumulativeScore }]) => {
            const isMe = name === currentUserName;
            const total = cumulativeScore > 0 ? cumulativeScore + score : null;
            return (
              <div
                key={name}
                className={`flex items-center gap-1.5 px-2 py-1 rounded-full whitespace-nowrap text-xs flex-shrink-0 ${
                  isMe ? 'bg-white/10 border border-white/20' : 'bg-white/5'
                }`}
                title={total != null ? `${name}: ${score.toLocaleString()} (${total.toLocaleString()})` : `${name}: ${score.toLocaleString()}`}
              >
                {dot(name, isMe, hueToCss(playerHue(playerColors, name)))}
                <span className="text-white truncate max-w-[6rem]">{name}</span>
                <span className="text-neon-green font-mono font-bold tabular-nums">{score.toLocaleString()}</span>
              </div>
            );
          })}
        </div>
        {colorPickerOpen && picker}
      </div>
    );
  }

  return (
    <div className="bg-surface-light/80 rounded-lg p-3 backdrop-blur-sm">
      <div className="text-xs text-gray-400 uppercase tracking-wider mb-2">{t('party.scores')}</div>
      {entries.map(([name, { score, cumulativeScore }]) => {
        const isMe = name === currentUserName;
        return (
          <div key={name} ref={isMe ? pickerRef : undefined}>
            <div className="flex items-center py-1 gap-2">
              {dot(name, isMe, hueToCss(playerHue(playerColors, name)))}
              <span className="text-white truncate flex-1 min-w-0 text-sm">{name}</span>
              <PingIndicator latencyMs={latencies[name]} size={10} />
              <div className="text-right flex-shrink-0">
                <span className="text-neon-green font-mono font-bold text-sm tabular-nums">{score.toLocaleString()}</span>
                {cumulativeScore > 0 && (
                  <div className="text-[10px] text-gray-500 font-mono tabular-nums leading-tight">{(cumulativeScore + score).toLocaleString()}</div>
                )}
              </div>
            </div>
            {isMe && colorPickerOpen && picker}
          </div>
        );
      })}
    </div>
  );
};

export default Scoreboard;
