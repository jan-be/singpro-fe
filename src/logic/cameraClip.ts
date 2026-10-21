import type { LyricData, LyricLine, TimedLyrics } from './LyricsParser';

/**
 * Influencer mode's camera (an account setting, SettingsPage): the singer
 * films themself while they sing, for a share video with them in it.
 *
 * What it keeps, and where: the camera is open only while a song plays in a
 * tab that is being looked at (cameraAction, as micStandby.ts does for the
 * microphone, but without its grace). Its frames are drawn at 540 × 960
 * (the share video's 9:16, mirrored as the singer sees themself) and encoded
 * to H.264 in the browser (WebCodecs), stamped with the song's time as the
 * notes are (the clock minus the delay to the speakers). All of it stays in
 * this tab's memory. When a song's take is uploaded, the server says which
 * moment its share video shows (POST /takes/:id/moment, logic/takes.ts); the
 * footage around that moment is cut out and kept, with the lyrics sung in
 * it, and the rest of the song's footage is dropped. Only when the singer
 * shares a video with the camera does that cut go to the server (as an FLV
 * file, flvFile), which makes the video and deletes it. What is kept here
 * goes when the tab closes, after FOOTAGE_KEEP_MS, or at the camera panel's
 * "Delete footage".
 */

export const CAMERA_W = 540;
export const CAMERA_H = 960;
export const CAMERA_FPS = 24;
export const CAMERA_BITRATE = 1_000_000;
/** A keyframe this often (s): a cut starts at most this much before the moment */
export const KEY_EVERY_S = 1;
/** How late a camera frame reaches the page after it was taken (s), roughly */
export const CAMERA_LATENCY_S = 0.06;
/** Footage kept on each side of the moment (s) */
export const MOMENT_MARGIN_S = 0.8;
/** The camera closes this long after the song stopped (a seek or a short pause keeps it), at once in a background tab */
export const CAMERA_IDLE_GRACE_MS = 2_000;
/** How long the cut moments stay in this tab, and how many */
export const FOOTAGE_KEEP_MS = 3 * 3600_000;
export const FOOTAGE_MAX = 12;

export const CAMERA_CODEC = 'avc1.42E01F'; // H.264 baseline 3.1: hardware encoders have it, no B-frames
export const encoderConfig = (): VideoEncoderConfig => ({
  codec: CAMERA_CODEC, width: CAMERA_W, height: CAMERA_H, bitrate: CAMERA_BITRATE, framerate: CAMERA_FPS,
  latencyMode: 'realtime', avc: { format: 'avc' },
});

// ── Whether to film ────────────────────────────────────────────────────

/** What cameraAction decides from */
export interface CameraStandbyState {
  /** the camera is open */
  open: boolean;
  /** it is being opened right now */
  opening: boolean;
  /** the singer wants it, sings (microphone, recordings saved) and a song plays */
  needed: boolean;
  /** the tab is in the background */
  hidden: boolean;
  /** how long nothing has needed it (ms) */
  idleMs: number;
}

/** Open the camera, close it, or nothing: open only when needed in a visible tab, closed in a background one at once */
export function cameraAction({ open, opening, needed, hidden, idleMs }: CameraStandbyState): 'open' | 'close' | null {
  if (open) return hidden || (!needed && idleMs >= CAMERA_IDLE_GRACE_MS) ? 'close' : null;
  return needed && !hidden && !opening ? 'open' : null;
}

/** Whether this browser can film for share videos: a camera, and WebCodecs to encode it (the encoder itself: cameraEncoderSupported) */
export const cameraSupported = () => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
  && typeof VideoEncoder === 'function' && typeof VideoFrame === 'function';

/** Whether the H.264 encoder takes our settings here */
export async function cameraEncoderSupported() {
  if (!cameraSupported()) return false;
  try { return !!(await VideoEncoder.isConfigSupported(encoderConfig())).supported; } catch { return false; }
}

// ── Pictures and pieces ────────────────────────────────────────────────

/** The middle of a `w` × `h` picture with the aspect of `outW` × `outH` (drawImage's source box) */
export function cropFor(w: number, h: number, outW = CAMERA_W, outH = CAMERA_H) {
  if (!(w > 0 && h > 0)) return { sx: 0, sy: 0, sw: 0, sh: 0 };
  const aspect = outW / outH;
  if (w / h > aspect) {
    const sw = Math.round(h * aspect);
    return { sx: Math.round((w - sw) / 2), sy: 0, sw, sh: h };
  }
  const sh = Math.round(w / aspect);
  return { sx: 0, sy: Math.round((h - sh) / 2), sw: w, sh };
}

/** The encoder's stream: its avcC record (the decoder configuration) */
export interface CameraTrack { description: Uint8Array }
/** One encoded frame: song seconds, whether it is a keyframe, its H.264 bytes (AVCC), the stream it belongs to */
export interface CameraChunk { t: number; key: boolean; data: Uint8Array; track: CameraTrack }

/** The chunks after song second `t` are gone (the song was rewound: the last pass is the one filmed) */
export const dropAfter = (chunks: CameraChunk[], t: number) => chunks.filter(c => c.t < t);

/**
 * The chunks that show song seconds `from` to `to`: from the last keyframe
 * at or before `from` (the first one after it when there is none), through
 * the last chunk at or before `to`, all of one stream (the first's). Empty
 * when nothing of it was filmed.
 */
export function cutChunks(chunks: readonly CameraChunk[], from: number, to: number): CameraChunk[] {
  let first = -1;
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    if (!c.key) continue;
    if (c.t <= from) first = i;
    else { if (first < 0 && c.t < to) first = i; break; }
  }
  if (first < 0) return [];
  const track = chunks[first].track;
  const out: CameraChunk[] = [];
  for (let i = first; i < chunks.length && chunks[i].t <= to; i++) {
    if (chunks[i].track !== track) break;
    // a frame stamped before the last one (a hiccup of the clock) would go backwards in the file
    if (out.length && chunks[i].t <= out[out.length - 1].t) continue;
    out.push(chunks[i]);
  }
  // footage that stopped before the moment began shows none of it
  return out.length && out[out.length - 1].t >= from ? out : [];
}

/**
 * The chunks as an FLV file (H.264 in FLV: what ffmpeg reads with each
 * frame's time, from 0 at the first chunk, in ms): the stream's
 * configuration first, then the frames.
 */
export function flvFile(track: CameraTrack, chunks: readonly CameraChunk[]): Uint8Array {
  const tags: { type: number; ms: number; body: Uint8Array }[] = [];
  const avc = (key: boolean, packet: number, payload: Uint8Array) => {
    const body = new Uint8Array(5 + payload.length);
    body[0] = (key ? 0x10 : 0x20) | 7; // frame type, codec 7 (AVC)
    body[1] = packet; // 0: the decoder configuration, 1: frames
    // (composition time 0: no B-frames in baseline)
    body.set(payload, 5);
    return body;
  };
  const t0 = chunks.length ? chunks[0].t : 0;
  tags.push({ type: 9, ms: 0, body: avc(true, 0, track.description) });
  for (const c of chunks) tags.push({ type: 9, ms: Math.max(0, Math.round((c.t - t0) * 1000)), body: avc(c.key, 1, c.data) });
  const size = 13 + tags.reduce((n, tag) => n + 11 + tag.body.length + 4, 0);
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  out.set([0x46, 0x4c, 0x56, 1, 0x01], 0); // "FLV", version 1, video only
  view.setUint32(5, 9); // header size
  view.setUint32(9, 0); // the first "previous tag size"
  let at = 13;
  for (const tag of tags) {
    const n = tag.body.length;
    out[at] = tag.type;
    out[at + 1] = (n >> 16) & 0xff; out[at + 2] = (n >> 8) & 0xff; out[at + 3] = n & 0xff;
    out[at + 4] = (tag.ms >> 16) & 0xff; out[at + 5] = (tag.ms >> 8) & 0xff; out[at + 6] = tag.ms & 0xff;
    out[at + 7] = (tag.ms >>> 24) & 0xff; // the timestamp's upper byte
    // (stream id: 0)
    out.set(tag.body, at + 11);
    view.setUint32(at + 11 + n, 11 + n);
    at += 11 + n + 4;
  }
  return out;
}

// ── The lyrics of a moment ─────────────────────────────────────────────

/** A syllable of a clip's lyrics: song seconds; golden notes say so */
export interface ClipSyllable { text: string; start: number; end: number; golden: boolean }
/** A line of a clip's lyrics */
export interface ClipLyricLine { start: number; end: number; syllables: ClipSyllable[] }

/** Song seconds of tick `tick` of the chart */
const secondsAt = (lyrics: Pick<TimedLyrics, 'gap' | 'bpm'>, tick: number) => lyrics.gap / 1000 + (tick * 60) / lyrics.bpm;

/**
 * The lines of `part` (a duet's second part: 2) sung between song seconds
 * `from` and `to`, with their syllables' times: what the share video shows
 * of the lyrics. Lines without a sung syllable are left out.
 */
export function lyricLinesIn(ld: LyricData | null | undefined, from: number, to: number, part = 1): ClipLyricLine[] {
  if (!ld || !(ld.bpm > 0)) return [];
  const lines: LyricLine[] = part === 2 && ld.p2 ? ld.p2.lyricLines : ld.lyricLines;
  const out: ClipLyricLine[] = [];
  for (const line of lines) {
    const syllables: ClipSyllable[] = [];
    for (const n of line) {
      if (n.isBreak) continue;
      syllables.push({ text: n.syllable, start: secondsAt(ld, n.start), end: secondsAt(ld, n.start + n.length), golden: n.isSpecial });
    }
    if (!syllables.length || !syllables.some(s => s.text.trim())) continue;
    const start = syllables[0].start, end = syllables[syllables.length - 1].end;
    if (end < from || start > to) continue;
    out.push({ start, end, syllables });
  }
  return out;
}

// ── The cut moments kept in this tab ───────────────────────────────────

/** A take's moment as filmed: its chunks (from a keyframe), the song seconds they cover, the lyrics sung in it */
export interface CameraSegment {
  recordingId: string;
  songId: string;
  track: CameraTrack;
  chunks: CameraChunk[];
  /** song seconds of the first chunk and the last */
  start: number;
  end: number;
  lyrics: ClipLyricLine[];
  /** Date.now() when it was cut */
  madeAt: number;
}

/**
 * The cut moments of this tab (by take), shared by every page of it: the
 * party's score screen and your profile share from it. Kept FOOTAGE_KEEP_MS
 * at most, FOOTAGE_MAX of them (the oldest goes first).
 */
export function createFootageStore(now = () => Date.now()) {
  const segments = new Map<string, CameraSegment>();
  const listeners = new Set<() => void>();
  let version = 0;
  const changed = () => { version++; for (const l of listeners) l(); };
  const expire = () => {
    let gone = false;
    for (const [id, s] of segments) if (now() - s.madeAt > FOOTAGE_KEEP_MS) { segments.delete(id); gone = true; }
    if (gone) changed();
  };
  return {
    put(segment: CameraSegment) {
      segments.delete(segment.recordingId);
      segments.set(segment.recordingId, segment);
      while (segments.size > FOOTAGE_MAX) segments.delete(segments.keys().next().value as string);
      changed();
    },
    /** The take's moment as filmed, if this tab has it */
    get(recordingId: string | null | undefined) {
      expire();
      return recordingId ? segments.get(recordingId) ?? null : null;
    },
    count() { expire(); return segments.size; },
    /** Delete it all */
    clear() { if (segments.size) { segments.clear(); changed(); } },
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    /** Changes with every change (useSyncExternalStore) */
    version: () => version,
  };
}
export type FootageStore = ReturnType<typeof createFootageStore>;

/** This tab's cut moments */
export const footage = createFootageStore();

// ── Filming ────────────────────────────────────────────────────────────

/** A song's footage so far */
interface SongFilm { songId: string; chunks: CameraChunk[] }

export interface CameraFilmOptions {
  /** the song on now (its id; null or 'none' between songs): each gets footage of its own */
  songId: () => string | null | undefined;
  /** the song second a frame taken now shows (the clock less the delay to the speakers and the camera's own) */
  songTime: () => number;
  /** whether to keep frames now: the song plays and its take is being recorded */
  filming: () => boolean;
  /** asks the server for a take's moment: song seconds { start, end } of its share video */
  moment: (recordingId: string, token: string | null) => Promise<{ start: number; end: number } | null>;
  /** where the cut moments go */
  store?: FootageStore;
  /** the camera opened, or closed */
  onLive?: (live: boolean) => void;
}

/**
 * The camera of influencer mode. open() asks for it (the browser asks the
 * singer the first time) and starts filming; close() lets go of it. Each
 * song (`songId`) is filmed on its own; attach() hands a song's take to it,
 * which cuts that take's moment out of the song's footage. `video` is the
 * camera's element (on the page, out of sight: some browsers give no frames
 * of one that is not), `canvas` what is filmed, which the preview shows.
 */
export function createCameraFilm({ songId, songTime, filming, moment, store = footage, onLive }: CameraFilmOptions) {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.autoplay = true;
  const canvas = document.createElement('canvas');
  canvas.width = CAMERA_W;
  canvas.height = CAMERA_H;
  const ctx = canvas.getContext('2d', { alpha: false });

  let stream: MediaStream | null = null;
  let encoder: VideoEncoder | null = null;
  let track: CameraTrack | null = null;
  let current: SongFilm | null = null;
  let previous: SongFilm | null = null; // the song before: its take may still be on the way
  const songTimes = new Map<number, { t: number; film: SongFilm }>(); // the encoder's timestamp (µs) -> song seconds, and whose
  let lastT = -Infinity;
  let due = -Infinity; // when the next frame is due (performance.now, s)
  let framesSinceKey = Infinity;
  let pump: number | null = null; // the frame callback or timer
  let stopped = true;
  let disposed = false;
  // The video element is kept out of sight (CameraPreview): any visible live camera video, even 2 px of it,
  // halved the page's frame rate in Chrome. A browser that gives no frames of a video out of sight (Safari has
  // been reported to) gets it shown, faintly, under the picture, once a second passed without one.
  let lastFrameAt = 0;
  let watchdog: number | null = null;
  const watch = () => {
    if (stopped || !stream || performance.now() - lastFrameAt < 1000 || video.style.visibility) return;
    video.style.visibility = 'visible';
    video.style.opacity = '0.01';
  };

  const newEncoder = () => {
    const e = new VideoEncoder({
      output: (chunk, meta) => {
        const desc = meta?.decoderConfig?.description;
        if (desc) track = { description: (ArrayBuffer.isView(desc) ? new Uint8Array(desc.buffer, desc.byteOffset, desc.byteLength) : new Uint8Array(desc)).slice() };
        const taken = songTimes.get(chunk.timestamp);
        songTimes.delete(chunk.timestamp);
        if (!taken || !track) return;
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        taken.film.chunks.push({ t: taken.t, key: chunk.type === 'key', data, track });
      },
      error: (err) => { console.warn('Camera encoder failed:', err.message); encoder = null; track = null; },
    });
    e.configure(encoderConfig());
    return e;
  };

  const dropFilm = (film: SongFilm | null) => { if (film) film.chunks = []; };
  /** A new song: its own footage; the one before waits for its take */
  const newSong = (id: string) => {
    dropFilm(previous);
    previous = current;
    current = { songId: id, chunks: [] };
    lastT = -Infinity;
    framesSinceKey = Infinity;
  };

  // Each camera frame is drawn on the canvas, CAMERA_FPS a second (the camera's 30 a second thinned out): what
  // is filmed and also the preview the singer sees (a live <video> on the page halved the page's frame rate
  // in Chrome, the canvas does not); while a song plays it is encoded too
  const frame = () => {
    lastFrameAt = performance.now();
    if (stopped || !ctx || !stream || video.readyState < 2 || !video.videoWidth) return;
    const now = performance.now() / 1000;
    if (now < due - 0.5 / CAMERA_FPS) return;
    due = (now - due > 1 / CAMERA_FPS ? now : due) + 1 / CAMERA_FPS;
    const { sx, sy, sw, sh } = cropFor(video.videoWidth, video.videoHeight);
    // mirrored, as the singer sees themself
    ctx.setTransform(-1, 0, 0, 1, CAMERA_W, 0);
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, CAMERA_W, CAMERA_H);

    const id = songId();
    if (!id || id === 'none') return;
    if (id !== current?.songId) newSong(id);
    if (!current) return;
    if (!filming()) { framesSinceKey = Infinity; return; }
    const t = songTime();
    if (!Number.isFinite(t)) return;
    if (t < lastT - 0.3) {
      // rewound: what comes now replaces what was filmed after it
      current.chunks = dropAfter(current.chunks, t);
      framesSinceKey = Infinity;
    } else if (t - lastT > 0.5) framesSinceKey = Infinity; // after a gap (a seek, a pause) the next one stands alone
    else if (t <= lastT) return; // the clock stood still
    if (!encoder || encoder.state === 'closed') { encoder = newEncoder(); framesSinceKey = Infinity; }
    if (encoder.encodeQueueSize > 2) return; // a slow phone: this frame is skipped, not queued
    lastT = t;
    const timestamp = Math.round(performance.now() * 1000);
    const vf = new VideoFrame(canvas, { timestamp });
    const key = framesSinceKey >= KEY_EVERY_S * CAMERA_FPS;
    songTimes.set(timestamp, { t, film: current });
    try { encoder.encode(vf, { keyFrame: key }); framesSinceKey = key ? 1 : framesSinceKey + 1; } finally { vf.close(); }
  };

  const schedule = () => {
    if (stopped) return;
    if (typeof video.requestVideoFrameCallback === 'function') {
      pump = video.requestVideoFrameCallback(() => { frame(); schedule(); });
    } else {
      pump = window.setTimeout(() => { frame(); schedule(); }, 1000 / CAMERA_FPS);
    }
  };
  const unschedule = () => {
    if (pump === null) return;
    if (typeof video.cancelVideoFrameCallback === 'function') video.cancelVideoFrameCallback(pump);
    window.clearTimeout(pump);
    pump = null;
  };

  return {
    video,
    canvas,
    get isOpen() { return !!stream; },

    /** Ask for the camera (the front one) and start filming. Rejects when it is refused or missing. */
    async open() {
      if (stream || disposed) return;
      const s = await navigator.mediaDevices.getUserMedia({
        audio: false, // the microphone is its own: its settings stay as they are
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } },
      });
      if (disposed) { for (const tr of s.getTracks()) tr.stop(); return; }
      stream = s;
      onLive?.(true);
      // taken away (the permission withdrawn, the camera unplugged): closed as if asked
      for (const tr of s.getVideoTracks()) tr.addEventListener('ended', () => { if (stream === s) this.close(); });
      video.srcObject = s;
      video.play().catch(() => {});
      stopped = false;
      framesSinceKey = Infinity;
      lastFrameAt = performance.now();
      watchdog ??= window.setInterval(watch, 500);
      schedule();
    },

    /** Let go of the camera (the browser stops showing it in use); the footage stays */
    close() {
      stopped = true;
      unschedule();
      if (watchdog !== null) window.clearInterval(watchdog);
      watchdog = null;
      if (stream) for (const tr of stream.getTracks()) tr.stop();
      stream = null;
      video.srcObject = null;
      encoder?.flush().catch(() => {});
      onLive?.(false);
    },

    /**
     * The song's take was uploaded: its moment is cut out of the song's
     * footage and kept (with the lyrics sung in it, from `lyrics`); a song
     * no longer on lets go of the rest.
     */
    async attach({ recordingId, token, songId, lyrics, part }: { recordingId: string; token: string | null; songId: string; lyrics: LyricData | null; part: number }) {
      const film = current?.songId === songId ? current : previous?.songId === songId ? previous : null;
      if (!film?.chunks.length) return null;
      await encoder?.flush().catch(() => {});
      let m: { start: number; end: number } | null = null;
      try { m = await moment(recordingId, token); } catch { m = null; }
      const chunks = m ? cutChunks(film.chunks, m.start - MOMENT_MARGIN_S, m.end + MOMENT_MARGIN_S) : [];
      if (film !== current) dropFilm(film);
      if (!m || chunks.length < CAMERA_FPS) return null; // under a second of it: not worth a video
      const segment: CameraSegment = {
        recordingId, songId, track: chunks[0].track, chunks,
        start: chunks[0].t, end: chunks[chunks.length - 1].t,
        lyrics: lyricLinesIn(lyrics, m.start, m.end, part),
        madeAt: Date.now(),
      };
      store.put(segment);
      return segment;
    },

    /** The footage of the songs on (not yet cut): gone, with the cut moments in `store` */
    forget() {
      dropFilm(current);
      dropFilm(previous);
      previous = null;
      if (current) current = { songId: current.songId, chunks: [] };
      store.clear();
    },

    dispose() {
      disposed = true;
      this.close();
      try { if (encoder && encoder.state !== 'closed') encoder.close(); } catch { /* closed already */ }
      encoder = null;
      dropFilm(current);
      dropFilm(previous);
      current = previous = null;
    },
  };
}
export type CameraFilm = ReturnType<typeof createCameraFilm>;

/** A cut moment as the file the server makes the video from, and the song second its first frame shows */
export const segmentFile = (s: CameraSegment) => ({ blob: new Blob([flvFile(s.track, s.chunks) as BlobPart], { type: 'video/x-flv' }), start: s.start });
