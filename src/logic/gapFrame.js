/**
 * A gap carried from one chart to another that plays the same video.
 *
 * Every chart has a base gap, its #GAP plus the video offset (the API's
 * defaultGap, or duetGap for the duet twin). A correction or a drag made on
 * one chart is the distance from that chart's base; carrying the gap keeps
 * the distance, so switching to the duet twin moves it by the same amount on
 * top of the twin's own base rather than handing it the solo chart's number.
 */
export const carryGap = (gap, fromBase, toBase) => {
  if (!Number.isFinite(toBase)) return gap;
  if (!Number.isFinite(gap) || !Number.isFinite(fromBase)) return toBase;
  return toBase + (gap - fromBase);
};
