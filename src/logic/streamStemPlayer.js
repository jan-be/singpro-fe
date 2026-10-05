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
// What an element cannot do is land a start or a seek on the dot: it is heard
// a moment later (0.3–0.5 s for a start on the stick, and a seek over the
// internet to a part not loaded yet takes as long as the network does), while
// the song's clock (`clock`, the page's video time) moves on. Chased by the
// page's sync, that was up to five audible jumps in a song's first seconds.
// So after a start or seek the stems stay faded out until they are heard, are
// measured against the clock every 100 ms, are moved again quietly while they
// are off, and fade in once they sit on it (or after 2 s regardless). Each
// start or seek aims ahead by what this device's last ones came out behind
// (`leads`, learned from those measurements and kept per device), so most
// fade in at the first measurement. Meanwhile `waiting` tells the page's sync
// to keep out.
//
// Same surface as StemPlayer: load / play / pause / seek / dispose, loaded,
// playing, currentTime, duration, ended.

const FADE = 0.02;            // s: fades in and out, so no jump is a click
const CHECK_MS = 100;         // how often a hidden start or seek is measured against the clock
const REVEAL_WITHIN = 0.04;   // s off the clock at most, to fade in
const MAX_HIDDEN_MS = 2000;   // fade in by then anyway: the page's sync takes over
const SETTLE_MAX_MS = 2000;   // a start or seek that never reports in counts as heard by then
const PAIR_TOLERANCE = 0.05;  // s the vocals may be off the instrumental before realign() moves them
const MAX_LEAD = 0.5;         // s: the most a start or seek is aimed ahead
const LEARN_RATE = 0.7;       // how much of a measured error goes into the lead
const NAMES = ['karaoke', 'vocals'];
const LEADS_KEY = 'singpro_stem_leads';

// What this device's elements take to be heard, shared by every song's player
// (0 is right for a fast device; a slow one learns its own on its first song)
const learned = (() => {
  const leads = { start: 0, seek: 0 };
  try {
    const saved = JSON.parse(localStorage.getItem(LEADS_KEY) || 'null');
    for (const k of ['start', 'seek']) if (Number.isFinite(saved?.[k])) leads[k] = Math.min(MAX_LEAD, Math.max(0, saved[k]));
  } catch { /* none yet, or no storage */ }
  return leads;
})();
const saveLeads = () => { try { localStorage.setItem(LEADS_KEY, JSON.stringify(learned)); } catch { /* */ } };

export class StreamingStemPlayer {
  /**
   * @param {AudioContext} ctx
   * @param {{ karaoke: GainNode, vocals: GainNode }} gains  the mix, owned by the page
   * @param {{ createElement?: () => HTMLAudioElement, clock?: () => number | null }} options
   *   clock: the song time the stems belong at right now (null: none to follow)
   */
  constructor(ctx, gains, { createElement = () => new Audio(), clock = () => null } = {}) {
    this.ctx = ctx;
    this.gains = gains;
    this.createElement = createElement;
    this.clock = clock;
    this.els = null;         // { karaoke, vocals }: the <audio> elements, once load() ran
    this.fades = null;       // { karaoke, vocals }: a GainNode each, for the fades
    this.sources = [];
    this.ready = false;
    this.position = 0;       // where it starts when play() gets no time
    this.ended = false;
    this.disposed = false;
    this.urls = null;
    this.mode = 'stream';
    this.leads = learned;    // s: how far ahead a start / a seek aims (see above)
    this.hidden = false;     // faded out after a start or seek until measured on the clock
    this.hiddenSince = 0;
    this.jumpKind = 'start'; // what the last jump was, for the lead it teaches
    this.measured = true;    // the last jump's outcome went into its lead already
    this.settling = false;   // the last jump not heard yet
    this.vocalsSettling = false; // realign() moved the vocals and they are not heard yet
    this.timer = null;
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
  /** Hidden, not heard yet, seeking or out of data: nothing for the page's sync to chase */
  get waiting() { return !!this.els && (this.hidden || this.settling || this.stalled); }
  get stalled() { return NAMES.some((n) => this.els[n].seeking || this.els[n].readyState < 3); }
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
    if (this.playing) { this.seek(time); return; }
    this.ended = false;
    this.jump(time, 'start');
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
    this.stopChecks();
  }

  seek(time) {
    this.position = Math.max(0, time);
    if (!this.ready) return;
    this.ended = false;
    if (this.playing) this.jump(this.position, 'seek');
    else for (const name of NAMES) this.els[name].currentTime = this.position;
  }

  /**
   * Both elements to `time` plus the lead for this kind of jump, faded out
   * until measured on the clock (see above).
   */
  jump(time, kind) {
    this.hide();
    this.jumpKind = kind;
    this.measured = false;
    const target = Math.max(0, time + this.leads[kind]);
    for (const name of NAMES) this.els[name].currentTime = target;
    this.settle();
    this.startChecks();
  }

  hide() {
    const at = this.ctx.currentTime;
    for (const name of NAMES) {
      const g = this.fades[name].gain;
      g.cancelScheduledValues(at);
      g.setValueAtTime(g.value, at);
      g.linearRampToValueAtTime(0, at + FADE);
    }
    if (!this.hidden) this.hiddenSince = performance.now();
    this.hidden = true;
  }

  reveal() {
    if (!this.hidden) return;
    this.hidden = false;
    this.stopChecks();
    const at = this.ctx.currentTime;
    for (const name of NAMES) {
      const g = this.fades[name].gain;
      g.cancelScheduledValues(at);
      g.setValueAtTime(g.value, at);
      g.linearRampToValueAtTime(1, at + FADE);
    }
  }

  /** Counts as not heard until the instrumental plays on ('playing' after a start, 'seeked' after a seek). */
  settle() {
    const el = this.els.karaoke;
    const token = (this.settleToken = (this.settleToken ?? 0) + 1);
    this.settling = true;
    const done = () => { if (this.settleToken === token) this.settling = false; };
    el.addEventListener('playing', done, { once: true });
    el.addEventListener('seeked', () => { if (!el.paused) done(); }, { once: true });
    setTimeout(done, SETTLE_MAX_MS);
  }

  startChecks() {
    if (this.timer === null) this.timer = setInterval(() => this.check(), CHECK_MS);
  }

  stopChecks() {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  /** While hidden: measure against the clock, learn, move again or fade in. */
  check() {
    if (this.disposed || !this.hidden) { this.stopChecks(); return; }
    if (!this.playing) return; // paused (or refused to play): waits for play()
    const late = performance.now() - this.hiddenSince > MAX_HIDDEN_MS;
    if ((this.settling || this.stalled) && !late) return;
    const t = this.clock();
    if (t === null || !Number.isFinite(t) || late) { this.reveal(); return; }
    const drift = t - this.currentTime; // positive: the stems came out behind
    if (!this.measured) {
      this.measured = true;
      this.leads[this.jumpKind] = Math.min(MAX_LEAD, Math.max(0, this.leads[this.jumpKind] + LEARN_RATE * drift));
      saveLeads();
    }
    if (Math.abs(drift) <= REVEAL_WITHIN) { this.reveal(); return; }
    this.jump(t, 'seek'); // still hidden: nobody hears this one
  }

  /**
   * Puts the vocals back on the instrumental where a stall parted them
   * (only one of them had to wait for data). Returns whether it did.
   */
  realign() {
    if (!this.ready || !this.playing || this.waiting || this.vocalsSettling) return false;
    const { karaoke, vocals } = this.els;
    const off = vocals.currentTime - karaoke.currentTime;
    if (Math.abs(off) <= PAIR_TOLERANCE) return false;
    this.log(`vocals ${off > 0 ? 'ahead of' : 'behind'} the instrumental by ${Math.abs(off).toFixed(2)} s: moved`);
    // aimed ahead by a seek's lag, faded out until it is heard, judged again only after
    this.vocalsSettling = true;
    const token = (this.vocalsToken = (this.vocalsToken ?? 0) + 1);
    const at = this.ctx.currentTime;
    const g = this.fades.vocals.gain;
    g.cancelScheduledValues(at);
    g.setValueAtTime(g.value, at);
    g.linearRampToValueAtTime(0, at + FADE);
    vocals.currentTime = karaoke.currentTime + this.leads.seek;
    const back = () => {
      if (this.vocalsToken !== token || this.disposed) return;
      this.vocalsSettling = false;
      if (this.hidden) return; // the pair is hidden anyway: reveal() brings both back
      const now = this.ctx.currentTime;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(1, now + FADE);
    };
    vocals.addEventListener('seeked', () => setTimeout(back, 150), { once: true });
    setTimeout(back, SETTLE_MAX_MS);
    return true;
  }

  dispose() {
    this.disposed = true;
    this.stopChecks();
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
