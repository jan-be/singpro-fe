// videoClock.js — the YouTube video's time, estimated from what the IFrame
// API reports about it.
//
// The API's getCurrentTime() is not read from the video: the player in the
// iframe posts its time to the page now and then ("infoDelivery": the time
// and when it was taken), and the API extrapolates from the last report, by
// at most a second. On a starved main thread (a Fire TV Stick, where the
// iframe shares the page's thread) the reports arrive late and the time in
// them is old: measured against the video's own frames, getCurrentTime() was
// up to 3.8 s behind while the picture played smoothly. Followed as it was,
// that clock dragged the stems back and forth every half second — the
// "skipped and repeated" audio — and the lyrics with them.
//
// What makes it usable: a report is never ahead of the video. Its time can
// be stale, never early (measured: reported minus true time at the report's
// stamp ≤ +1 ms, down to −4.6 s). So every report gives a lower bound of the
// video's offset (video time − wall time), and while the video plays on
// without a jump, the highest bound seen so far is the estimate. It leaks
// downwards by 1 ms/s so a slow clock drift cannot keep an old maximum;
// measured, it stayed within ±45 ms of the picture where the API was off by
// seconds. Anything that changes the offset — a pause, buffering, a seek of
// ours, the video starting — starts a new epoch. So does a video that
// stopped moving while YouTube still says "playing" (it ran out of data: on
// the starved stick for up to 20 s, the "buffering" news seconds behind):
// reports whose time stands still are believed over the state.

export const LEAK = 0.001;        // s per s: how fast the bound sinks between reports
export const SEEK_GRACE = 10;     // s: after our seek, reports that do not show it are old ones, for at most this long
const SEEK_SLACK = 0.3;           // s: where a report may land around a seek target
const MOVED = 0.05;               // s past the target: the video plays on from there
const STUCK = 0.5;                // s of report stamps without the time moving: stalled, whatever the state says

/**
 * One report from the player, as the IFrame API holds it: `time` was the
 * video's time at `at` (seconds on the Date.now() clock) and `state` its
 * state. Without the API's internals, its extrapolated getCurrentTime() taken
 * now is a report too — still never ahead of the video.
 */
export function readPlayer(player, now = Date.now() / 1000) {
  if (!player) return null;
  try {
    const info = player.playerInfo;
    if (info && Number.isFinite(info.currentTime) && Number.isFinite(info.currentTimeLastUpdated_)) {
      return { time: info.currentTime, at: info.currentTimeLastUpdated_, state: info.playerState, rate: info.playbackRate || 1 };
    }
    const time = player.getCurrentTime?.();
    if (!Number.isFinite(time)) return null;
    return { time, at: now, state: player.getPlayerState?.(), rate: player.getPlaybackRate?.() || 1 };
  } catch { return null; }
}

export class VideoClock {
  constructor() { this.reset(); }

  reset() {
    this.mode = 'unknown';   // 'playing' | 'stopped' | 'seeking' | 'unknown'
    this.epoch = 0;          // counts the jumps: whatever moved the video other than playing on
    this.offset = null;      // while playing: the estimate of video time − rate × wall time
    this.rate = 1;
    this.lastAt = null;      // the stamp of the newest report taken in
    this.lag = null;         // how far the newest report sat below the estimate (its staleness)
    this.frozen = 0;         // while stopped or seeking: where the video stands
    this.seek = null;        // { target, at }: a seek of ours no report has shown yet
    this.reports = 0;        // reports taken in this epoch
    this.moved = null;       // while playing: { time, at } of the last report that showed the video moving
    this.stuck = false;      // stopped because the time stood still, not because YouTube said so
    this.since = null;       // when (Date.now() s) this epoch was learned of
  }

  /**
   * Takes in a report (see readPlayer) read at `now`. The API keeps the last
   * one until the next arrives, so most reads repeat it; a new state can
   * come without a new time.
   */
  observe(r, now = Date.now() / 1000) {
    if (!r || !Number.isFinite(r.time) || !Number.isFinite(r.at)) return;
    const fresh = r.at !== this.lastAt;
    const playing = r.state === 1;
    const rate = r.rate || 1;
    if (this.mode === 'seeking') {
      // Until a report shows our seek, the ones still arriving were taken
      // before it. On a starved Fire TV the command itself took 3 s to reach
      // the player. Playing, it has to show the video moving on from the
      // target: YouTube says "playing" at the target while it still seeks.
      const { target, at } = this.seek;
      const landed = fresh && r.at >= at && r.time >= target - SEEK_SLACK && r.time <= target + Math.max(0, r.at - at) * rate + SEEK_SLACK;
      const shows = landed && (!playing || r.time > target + MOVED);
      if (!shows && now - at < SEEK_GRACE) return;
      this.seek = null;
      this.startEpoch(playing ? 'playing' : 'stopped', r.time, r.at >= at ? r.at : now, rate, now);
      return;
    }
    if (!playing) {
      if (this.mode !== 'stopped') this.startEpoch('stopped', r.time, r.at, rate, now);
      else if (fresh && r.at > this.lastAt) { this.frozen = r.time; this.lastAt = r.at; this.stuck = false; }
      return;
    }
    if (this.mode === 'stopped' && this.stuck) {
      // "Playing" all along: it plays again once a report shows the time moving
      if (!fresh || r.at < this.lastAt) return;
      if (r.time <= this.frozen + MOVED) { this.lastAt = r.at; return; }
      this.startEpoch('playing', r.time, r.at, rate, now);
      return;
    }
    if (this.mode !== 'playing' || rate !== this.rate) {
      // A time taken before the video (re)started is where it stood until
      // `now` at the latest: a lower bound like any other
      this.startEpoch('playing', r.time, fresh && r.at > (this.lastAt ?? -Infinity) ? r.at : now, rate, now);
      return;
    }
    if (!fresh || r.at < this.lastAt) return; // the same report again, or one overtaken
    if (r.time > this.moved.time + 0.02) this.moved = { time: r.time, at: r.at };
    else if (r.time >= this.moved.time && r.at - this.moved.at >= STUCK) { // the same time again (an older one is only stale)
      this.startEpoch('stopped', this.moved.time, r.at, rate, now);
      this.stuck = true;
      return;
    }
    const o = r.time - r.at * rate;
    this.offset = Math.max(this.offset - LEAK * (r.at - this.lastAt), o);
    this.lag = this.offset - o;
    this.lastAt = r.at;
    this.reports += 1;
  }

  startEpoch(mode, time, at, rate, now) {
    this.epoch += 1;
    this.mode = mode;
    this.rate = rate;
    this.lastAt = at;
    this.reports = 1;
    this.lag = 0;
    this.stuck = false;
    this.since = now;
    if (mode === 'playing') { this.offset = time - at * rate; this.moved = { time, at }; }
    else { this.offset = null; this.frozen = time; }
  }

  /** How long the video has been known to stand still (0 unless stopped) */
  stoppedFor(now = Date.now() / 1000) {
    return this.mode === 'stopped' && this.since !== null ? now - this.since : 0;
  }

  /**
   * We told the player to seek: the video stands at `target` until a report
   * shows it there (the reports still on their way are from before).
   */
  seeked(target, now = Date.now() / 1000) {
    this.epoch += 1;
    this.mode = 'seeking';
    this.seek = { target, at: now };
    this.since = now;
    this.stuck = false;
    this.frozen = target;
    this.offset = null;
    this.lag = null;
    this.reports = 0;
  }

  /** The video's time at `now` (Date.now() seconds), or null before any report. */
  timeAt(now = Date.now() / 1000) {
    if (this.mode === 'playing') return this.offset + now * this.rate;
    if (this.mode === 'unknown') return null;
    return this.frozen;
  }

  /** For the debug overlay: the estimate, how stale the newest report was, how old it is. */
  info(now = Date.now() / 1000) {
    return {
      mode: this.mode, epoch: this.epoch, time: this.timeAt(now), reports: this.reports,
      lag: this.mode === 'playing' ? this.lag : null,
      age: this.lastAt === null ? null : now - this.lastAt,
    };
  }
}
