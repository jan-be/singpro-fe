// stemPlayer.js — the two stems, decoded into memory and played through Web
// Audio on the AudioContext's clock.
//
// They used to be <audio> elements routed into the context for the mix. On
// iOS a seek on such an element never completes: the position stays put,
// the attempt is heard as a hiccup and the "seeking" flag stays up — so the
// stems could neither follow the timeline nor be held near the video, in
// Ogg or CAF, over the network or from a Blob. An AudioBufferSourceNode has
// no seek at all: playback from any offset is a new node started there,
// sample-accurate and at once, and two nodes started together stay
// together. The price is memory: decoded audio is float32 at the context's
// rate, ~100 MB for a four-minute stereo stem, held for the current song.

const FADE = 0.02; // s: a new start crossfades over the old one, so a jump is a jump, not a click

export class StemPlayer {
  constructor(ctx, gains) {
    this.ctx = ctx;
    this.gains = gains;      // { karaoke: GainNode, vocals: GainNode }: the mix, owned by the page
    this.buffers = null;
    this.duration = 0;
    this.active = null;      // { karaoke: { source, fade }, vocals: {...} } while playing
    this.position = 0;       // song time: where it is paused, or where the last start began
    this.startedAt = null;   // ctx.currentTime of the last start, while playing
    this.ended = false;
    this.disposed = false;
  }

  /** Fetches and decodes both files; resolves once both are in. */
  async load(urls, { fetchImpl = (url) => fetch(url), decode = (bytes) => this.ctx.decodeAudioData(bytes), log = () => {} } = {}) {
    const one = async (name) => {
      const t0 = performance.now();
      const response = await fetchImpl(urls[name]);
      if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
      const bytes = await response.arrayBuffer();
      const size = bytes.byteLength; // decoding detaches the buffer
      const t1 = performance.now();
      let buffer;
      try { buffer = await decode(bytes); } catch (e) { throw new Error(`${name}: cannot decode (${e?.message ?? e})`); }
      log(`${name}: ${(size / 1e6).toFixed(1)} MB in ${Math.round(t1 - t0)} ms, decoded ${buffer.duration.toFixed(1)} s / ${buffer.numberOfChannels} ch / ${buffer.sampleRate} Hz in ${Math.round(performance.now() - t1)} ms`);
      return buffer;
    };
    const [karaoke, vocals] = await Promise.all([one('karaoke'), one('vocals')]);
    if (this.disposed) return this; // the song changed while loading: nothing to keep
    this.buffers = { karaoke, vocals };
    this.duration = Math.max(karaoke.duration, vocals.duration);
    return this;
  }

  get loaded() { return this.buffers !== null; }
  get playing() { return this.startedAt !== null; }
  /** The song time the stems are at */
  get currentTime() { return this.startedAt === null ? this.position : this.position + (this.ctx.currentTime - this.startedAt); }

  /** Starts both stems at `time`; a pair already running crossfades into the new one. */
  play(time = this.position) {
    if (!this.buffers) return;
    const { ctx } = this;
    const at = ctx.currentTime;
    const previous = this.active;
    const nodes = {};
    for (const name of ['karaoke', 'vocals']) {
      const source = ctx.createBufferSource();
      source.buffer = this.buffers[name];
      const fade = ctx.createGain();
      fade.gain.setValueAtTime(previous ? 0 : 1, at);
      if (previous) fade.gain.linearRampToValueAtTime(1, at + FADE);
      source.connect(fade);
      fade.connect(this.gains[name]);
      source.start(at, Math.max(0, time));
      nodes[name] = { source, fade };
    }
    this.retire(previous, at);
    this.active = nodes;
    this.position = time;
    this.startedAt = at;
    this.ended = false;
    // The buffer ran out (a stop() has this handler removed first)
    nodes.karaoke.source.onended = () => {
      if (this.active !== nodes) return;
      this.retire(nodes, this.ctx.currentTime);
      this.active = null;
      this.startedAt = null;
      this.position = this.duration;
      this.ended = true;
    };
  }

  pause() {
    if (!this.active) return;
    this.position = this.currentTime;
    this.retire(this.active, this.ctx.currentTime);
    this.active = null;
    this.startedAt = null;
  }

  seek(time) {
    if (this.active) this.play(time);
    else { this.position = Math.max(0, time); this.ended = false; }
  }

  retire(nodes, at) {
    if (!nodes) return;
    for (const { source, fade } of Object.values(nodes)) {
      source.onended = null;
      fade.gain.cancelScheduledValues(at);
      fade.gain.setValueAtTime(fade.gain.value, at);
      fade.gain.linearRampToValueAtTime(0, at + FADE);
      try { source.stop(at + FADE + 0.005); } catch { /* already stopped */ }
    }
  }

  dispose() {
    this.pause();
    this.buffers = null;
    this.disposed = true;
  }
}

/** A second of silence as a WAV file (8 kHz, 16-bit, mono). */
export function silentWav() {
  const rate = 8000, bytes = rate * 2;
  const buf = new ArrayBuffer(44 + bytes);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + bytes, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, bytes, true);
  return buf;
}

// iOS plays Web Audio through the "ambient" audio session, which the
// ring/silent switch mutes — unless a media element is playing. The stems
// no longer are one, so the page loops this while they play.
let silentUrl = null;
export function silentWavUrl() {
  if (!silentUrl) silentUrl = URL.createObjectURL(new Blob([silentWav()], { type: 'audio/wav' }));
  return silentUrl;
}
