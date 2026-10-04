import React from "react";
import { useTranslation } from "react-i18next";

// corner: sticks out of a small thumbnail's top-left corner (queue, search rows);
// pill: sits inside a big card next to its other pills (the song grid, the score screen)
const LOOKS = {
  sm: 'absolute -top-1 -left-1 px-1 rounded-[5px] text-[9px] font-black leading-[14px] shadow-[0_1px_3px_rgba(0,0,0,0.45)]',
  md: 'absolute -top-1.5 -left-1.5 px-1.5 rounded-md text-[10px] font-bold leading-4 tracking-wide shadow-[0_1px_3px_rgba(0,0,0,0.45)]',
  pill: 'absolute top-2 left-2 h-6 px-2 rounded-full text-[11px] font-bold tracking-wide flex items-center shadow-[0_1px_3px_rgba(0,0,0,0.45)]',
};

/**
 * "AI" on a song whose karaoke chart the AI made from the video (songs.generated,
 * or a chart still being made), so nobody mistakes it for a hand-made one.
 * The parent positions it: it needs a `relative` box around the thumbnail.
 */
const AiBadge = ({ look = 'sm' }) => {
  const { t } = useTranslation();
  return (
    <span title={t('chartJob.aiTitle')} className={`${LOOKS[look]} text-white bg-neon-purple`}>
      {t('chartJob.ai')}
    </span>
  );
};

export default AiBadge;
