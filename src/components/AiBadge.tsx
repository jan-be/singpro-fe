import React from "react";
import { useTranslation } from "react-i18next";
import { SparklesIcon } from "./Icons";

// corner: sticks out of a small thumbnail's top-left corner (queue, search rows);
// pill: sits inside a big card next to its other pills (the song grid, the score screen)
const LOOKS = {
  sm: { box: 'absolute -top-1 -left-1 h-[15px] px-[3px] gap-0.5 rounded-[5px] text-[9px] font-black', icon: 10 },
  md: { box: 'absolute -top-1.5 -left-1.5 h-[18px] px-1 gap-0.5 rounded-md text-[10px] font-bold', icon: 12 },
  pill: { box: 'absolute top-2 left-2 h-6 px-1.5 gap-1 rounded-full text-[11px] font-bold', icon: 14 },
};

export interface AiBadgeProps {
  look?: keyof typeof LOOKS;
  beta?: boolean;
}

/**
 * The AI's sparkles on a song whose karaoke chart the AI made from the video
 * (songs.generated, or a chart still being made), so nobody mistakes it for a
 * hand-made one. `beta`: the generator's check found it rougher than its
 * published charts (chart_jobs.qa.decision), which the badge says in words.
 * The parent positions it: it needs a `relative` box around the thumbnail.
 */
const AiBadge = ({ look = 'sm', beta = false }: AiBadgeProps) => {
  const { t } = useTranslation();
  const { box, icon } = LOOKS[look];
  return (
    <span
      title={t(beta ? 'chartJob.betaTitle' : 'chartJob.aiTitle')}
      className={`${box} flex items-center leading-none tracking-wide text-white bg-neon-purple shadow-[0_1px_3px_rgba(0,0,0,0.45)]`}
    >
      <SparklesIcon size={icon} />
      {beta && <span>{t('chartJob.beta')}</span>}
    </span>
  );
};

export default AiBadge;
