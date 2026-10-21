/**
 * The YouTube IFrame API's player (YT.Player) as the party page uses it: the
 * object VideoPlayer hands over (react-youtube's event.target). Only what the
 * page calls; `@types/youtube` (YT.Player) would replace this.
 *
 * States (getPlayerState): -1 unstarted, 0 ended, 1 playing, 2 paused,
 * 3 buffering, 5 cued.
 */
export interface YouTubePlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  mute(): void;
  unMute(): void;
  /** the player's last report; undefined right after a video was loaded into it */
  isMuted(): boolean | undefined;
  /** 0–100 */
  setVolume(volume: number): void;
  /** as isMuted */
  getVolume(): number | undefined;
  setPlaybackRate(rate: number): void;
  getPlaybackRate(): number;
  getPlayerState(): number;
  getCurrentTime(): number;
  getDuration(): number;
  getPlaybackQuality(): string;
}
