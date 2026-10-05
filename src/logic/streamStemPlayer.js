// streamStemPlayer.js — the two stems streamed by <audio> elements and mixed
// through Web Audio, for every browser but Apple's (see stemPlayback.js).
//
// Decoding both files whole (stemPlayer.js) took 9–21 s on a Fire TV stick,
// so each song began silent, and its ~200 MB of float samples went into a
// device with 335 MB free and a full swap. A media element decodes as it
// plays: it starts after the first few hundred kilobytes and holds seconds,
// not minutes. A seek is the element's own (the server answers Range
// requests). Both elements play through the page's AudioContext, which pulls
// them at its own clock, so started together they stay together; realign()
// puts the vocals back on the instrumental where a stall has parted them.
//
// Same surface as StemPlayer: load / play / pause / seek / dispose, loaded,
// playing, currentTime, duration, ended. What it cannot do is jump without a
// gap: a seek is a short fade out and in around the element's own seek.
//
// Nor is a start or a seek heard at once: on a Fire TV stick 0.1–0.3 s pass
// before the element sounds, while the song's clock moves on, so it started
// behind and was restarted twice in its first seconds. So each start or seek
// aims ahead (`leads`: a start from pause takes longer than a seek while
// playing), counts as `waiting` until it sounds — not drift for the page to
// chase — and the page reports how far off it came out (learn()), which
// corrects that lead: the outcome, not event timings, which on the stick
// said little about where the music landed. What it learned carries over to
// the next song and visit (localStorage), so only a device's first start
// can miss.

const FADE = 0.02;          // s: fade out before a seek and in after it, so a jump is not a click
const SEEK_SETTLE_MS = 1500; // fade back in by then even if 'seeked' never came
const PAIR_TOLERANCE = 0.05; // s the vocals may be off the instrumental before realign() moves them
const MAX_LEAD = 0.5;        // s: the most a start or seek is aimed ahead
const SETTLE_MAX_MS = 2000;  // a start or seek that never reports in counts as done by then
const LEARN_RATE = 0.7;      // how much of an outcome's error goes into the lead
const NAMES = ['karaoke', 'vocals'];
const LEADS_KEY = 'singpro_stem_leads';

// What this device's elements take to be heard, shared by every song's player
const learned = (() => {
  const leads = { start: 0, seek: 0 }; // right for a fast device; a slow one learns its own from its first song
  try {
    const saved = JSON.parse(localStorage.getItem(LEADS_KEY) || 'null');
    for (const k of ['start', 'seek']) if (Number.isFinite(saved?.[k])) leads[k] = Math.min(MAX_LEAD, Math.max(0, saved[k]));
  } catch { /* none yet, or no storage */ }
  return leads;
})();
const saveLeads = () => { try { localStorage.setItem(LEADS_KEY, JSON.stringify(learned)); } catch { /* */ } };

export class StreamingStemPlayer {
  constructor(ctx, gains, { createElement = () => new Audio() } = {}) {
    this.ctx = ctx;
    this.gains = gains;      // { karaoke: GainNode, vocals: GainNode }: the mix, owned by the page
    this.createElement = createElement;
    this.els = null;         // { karaoke, vocals }: the <audio> elements, once load() ran
    this.fades = null;       // { karaoke, vocals }: a GainNode each, for the seek fades
    this.sources = [];
    this.ready = false;
    this.position = 0;       // where it starts when play() gets no time
    this.ended = false;
    this.disposed = false;
    this.urls = null;
    this.mode = 'stream';
    this.leads = learned;    // s: how long a start / a seek takes to be heard (learned, see above)
    this.settling = false;   // a start or seek not heard yet
    this.toLearn = null;     // 'start' | 'seek': the jump whose outcome learn() is waiting for
    this.vocalsSettling = false; // realign() moved the vocals and they are not heard yet
    this.log = () => {};
  }

  /** Points both elements at their files; resolves once both can play. */
  load(urls, { log = () => {}, timeoutMs = 30000 } = {}) {
    this.urls = urls;
    this.log = log;
    const t0 = performance.now();
    this.els = {};
    this.fades = {};
    const ready = NAMES.map((name) => new Promise((resolve, reject) => {
      const el = this.createElement();
      el.crossOrigin = 'anonymous';
      el.preload = 'auto';
      this.els[name] = el;
      const fade = this.ctx.createGain();
      fade.connect(this.gains[name]);
      this.fades[name] = fade;
      const source = this.ctx.createMediaElementSource(el);
      source.connect(fade);
      this.sources.push(source);
      const timer = setTimeout(() => reject(new Error(`${name}: no data after ${Math.round(timeoutMs / 1000)} s`)), timeoutMs);
      el.addEventListener('canplay', () => {
        clearTimeout(timer);
        log(`${name}: can play after ${Math.round(performance.now() - t0)} ms (streamed)`);
        resolve();
      }, { once: true });
      el.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error(`${name}: cannot play (media error ${el.error?.code ?? '?'})`));
      }, { once: true });
      if (name === 'karaoke') el.addEventListener('ended', () => { this.ended = true; });
      el.src = urls[name];
    }));
    return Promise.all(ready).then(() => {
      if (!this.disposed) this.ready = true;
      return this;
    });
  }

  get loaded() { return this.ready; }
  get playing() { return !!this.els && !this.els.karaoke.paused; }
  get failed() { return !!this.els && NAMES.some((n) => this.els[n].error); }
  /** Still seeking, or waiting for data: its time stands still for now, which is not drift */
  get waiting() { return !!this.els && (this.settling || NAMES.some((n) => this.els[n].seeking || this.els[n].readyState < 3)); }
  /** The song time the stems are at: the instrumental's, which the vocals follow */
  get currentTime() { return this.ready ? this.els.karaoke.currentTime : this.position; }
  get duration() {
    if (!this.els) return 0;
    const d = NAMES.map((n) => this.els[n].duration).filter(Number.isFinite);
    return d.length ? Math.max(...d) : 0;
  }
  /** Nothing is decoded ahead: the elements hold a few seconds each */
  get decodedBytes() { return 0; }

  /** Starts both stems at `time` (or where they are); a pair already playing jumps there. */
  play(time = this.position) {
    if (!this.ready) return;
    const wasPlaying = this.playing;
    // a start is heard that much late: aim there, so the stems meet the clock
    const target = wasPlaying ? time + this.leads.seek : time + this.leads.start;
    if (Math.abs(this.els.karaoke.currentTime - target) > 0.02 || Math.abs(this.els.vocals.currentTime - target) > 0.02) this.moveTo(target, wasPlaying ? 'seek' : 'start');
    else if (!wasPlaying) this.settle('start');
    this.ended = false;
    for (const name of NAMES) {
      // rejected without a user gesture on a phone: the page's silence
      // watchdog sees the stems paused and offers "tap for sound"
      this.els[name].play().catch((e) => this.log(`${name}: play() rejected: ${e?.name ?? e}`));
    }
  }

  pause() {
    if (!this.els) return;
    for (const name of NAMES) this.els[name].pause();
    this.position = this.currentTime;
  }

  seek(time) {
    this.position = Math.max(0, time);
    if (!this.ready) return;
    this.ended = false;
    this.moveTo(this.playing ? this.position + this.leads.seek : this.position, 'seek');
  }

  /**
   * Puts the vocals back on the instrumental where a stall parted them
   * (only one of them had to wait for data). Returns whether it did.
   */
  realign() {
    if (!this.ready || !this.playing || this.settling || this.vocalsSettling) return false;
    const { karaoke, vocals } = this.els;
    if (karaoke.seeking || vocals.seeking) return false;
    const off = vocals.currentTime - karaoke.currentTime;
    if (Math.abs(off) <= PAIR_TOLERANCE) return false;
    this.log(`vocals ${off > 0 ? 'ahead of' : 'behind'} the instrumental by ${Math.abs(off).toFixed(2)} s: moved`);
    // a seek is heard late (leads.seek): aim ahead, and judge again only once it is heard
    this.vocalsSettling = true;
    const token = (this.vocalsToken = (this.vocalsToken ?? 0) + 1);
    const settled = () => { if (this.vocalsToken === token) this.vocalsSettling = false; };
    vocals.addEventListener('seeked', () => setTimeout(settled, 300), { once: true });
    setTimeout(settled, SETTLE_MAX_MS);
    this.fadeAround(['vocals'], () => { vocals.currentTime = karaoke.currentTime + this.leads.seek; });
    return true;
  }

  /**
   * The page's measure of the clock minus the stems, at its first sync check
   * after a start or seek was heard: whatever is left over goes into that
   * jump's lead (positive: they came out behind, aim further ahead).
   */
  learn(drift) {
    const kind = this.toLearn;
    if (!kind || this.settling || !Number.isFinite(drift)) return;
    this.toLearn = null;
    this.leads[kind] = Math.min(MAX_LEAD, Math.max(0, this.leads[kind] + LEARN_RATE * drift));
    saveLeads();
  }

  /** Counts as waiting until the instrumental is heard again ('playing' after a start, 'seeked' after a seek while playing). */
  settle(kind) {
    const el = this.els.karaoke;
    const token = (this.settleToken = (this.settleToken ?? 0) + 1);
    this.settling = true;
    const done = () => {
      if (this.settleToken !== token || !this.settling) return;
      this.settling = false;
      this.toLearn = kind;
    };
    el.addEventListener('playing', done, { once: true });
    el.addEventListener('seeked', () => { if (!el.paused) done(); }, { once: true });
    setTimeout(() => { if (this.settleToken === token) this.settling = false; }, SETTLE_MAX_MS);
  }

  /** Both elements to `time`, faded out and back in while they seek if they are audible. */
  moveTo(time, kind = 'seek') {
    const t = Math.max(0, time);
    this.settle(kind);
    if (!this.playing) {
      for (const name of NAMES) this.els[name].currentTime = t;
      return;
    }
    this.fadeAround(NAMES, () => { for (const name of NAMES) this.els[name].currentTime = t; });
  }

  fadeAround(names, jump) {
    const at = this.ctx.currentTime;
    for (const name of names) {
      const g = this.fades[name].gain;
      g.cancelScheduledValues(at);
      g.setValueAtTime(g.value, at);
      g.linearRampToValueAtTime(0, at + FADE);
    }
    jump();
    for (const name of names) {
      const el = this.els[name];
      let done = false;
      const back = () => {
        if (done || this.disposed) return;
        done = true;
        const now = this.ctx.currentTime;
        const g = this.fades[name].gain;
        g.cancelScheduledValues(now);
        g.setValueAtTime(g.value, now);
        g.linearRampToValueAtTime(1, now + FADE);
      };
      el.addEventListener('seeked', back, { once: true });
      setTimeout(back, SEEK_SETTLE_MS);
    }
  }

  dispose() {
    this.disposed = true;
    if (this.els) {
      for (const name of NAMES) {
        const el = this.els[name];
        el.pause();
        el.removeAttribute('src');
        try { el.load(); } catch { /* */ }
      }
    }
    for (const s of this.sources) { try { s.disconnect(); } catch { /* */ } }
    for (const f of Object.values(this.fades ?? {})) { try { f.disconnect(); } catch { /* */ } }
    this.sources = [];
    this.ready = false;
  }
}
