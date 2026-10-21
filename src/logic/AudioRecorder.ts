import { apiUrl } from '../GlobalConsts';

const MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4',
];

function getPreferredMimeType() {
  if (typeof MediaRecorder === 'undefined') return '';
  return MIME_TYPES.find(t => MediaRecorder.isTypeSupported(t)) || '';
}

// Enough for a 10-minute song at the pipeline's ~33 pitches a second
export const MAX_NOTES = 20000;

/** How the pitch pipeline reads the mic (MicrophoneInput.js), kept with every recording */
export interface RecordingCapture {
  /** how the samples are read: 'trackProcessor' | 'worklet' */
  path: string;
  /** which pitch worker ran: 'wasm-min' | 'webgpu' (older recordings: 'wasm', 'wasm-1.18') */
  pitch?: string;
  sampleRate: number;
  /** the browser's own estimate, where it gives one */
  inputLatency: number | null;
  windowSeconds: number;
  hopSeconds: number;
}

/** What the page starts a recording with (the song, the party, whose take it is); uploaded as it is */
export interface RecordingMeta {
  songId?: string;
  /** when the play started (ms), as the party's server named it */
  playStartedAt?: number | null;
  score?: number | null;
  [key: string]: unknown;
}

/** One detected window as recordNote takes it */
export interface RecordedWindow {
  /** the video time it was scored at (s) */
  videoTime: number;
  freq: number;
  volume: number;
  fric?: number;
  /** where the window ends on the capture's clock (s) */
  pos?: number;
  /** the singing delay taken off it (s), and where that came from */
  delay?: number;
  delaySource?: string | null;
  held?: boolean;
}

/** A window as uploaded (clientNotes): t video time, f Hz, v level, a its place in the audio, c consonant, h held */
export interface ClientNote {
  t: number;
  f: number;
  v: number;
  a?: number;
  c?: 1;
  h?: 1;
}

/** The singing delay taken off the notes, each time it changed */
export interface RecordedDelay {
  t: number;
  d: number;
  src: string | null;
}

/** What the page adds at the upload */
export interface RecordingExtra {
  /** this browser's own estimate */
  score?: number | null;
  /** what the server scored */
  serverScore?: number | null;
  /** which part of a duet was sung */
  part?: number | null;
  gapAtEnd?: number | null;
}

/** The server's answer to an upload */
export interface RecordingUploadResult {
  success?: boolean;
  recordingId?: string;
  /** a guest's token for the take */
  token?: string;
}

/**
 * Records the singer's microphone for one song, with the pitch the app
 * detected in it (clientNotes): the singer's take, which they can listen to
 * on their profile and share as a video, and which we use for checking and
 * improving the detection. Only started while "Save recordings" is on
 * (logic/takes.js); the metadata the page starts it with says whose it is.
 *
 * Every note says where its audio window ends in this recording (`a`,
 * seconds), next to the video time it was scored at (`t`). The recording
 * pauses with the song and the capture's clock stands still with it, so `a`
 * runs with the audio while `t` jumps wherever the video is sought: a
 * recording lines up with its song exactly, seeks and pauses included, and
 * `t` minus the video time of `a` is the whole delay from sound to score.
 * (Before `a`, a recording had to be matched to its song by the pitches, and
 * any seek broke that.)
 */
export class UserAudioRecorder {
  declare stream: MediaStream | null;
  declare position: (() => number) | null;
  declare capture: RecordingCapture | null;
  declare startPos: number;
  declare mediaRecorder: MediaRecorder | null;
  declare chunks: Blob[];
  declare metadata: RecordingMeta;
  declare clientNotes: ClientNote[];
  declare delays: RecordedDelay[];
  declare startTime: number;
  declare isRecording: boolean;
  declare preferredMimeType: string;
  declare paused: boolean;
  declare pausedAt: number;
  declare pausedTotal: number;

  /**
   * @param stream the microphone
   * @param [options]
   *   position: the capture's clock (seconds of audio taken in while active,
   *   MicrophoneInput.js); capture: how the pitch pipeline reads the mic, kept
   *   with every recording
   */
  constructor(stream: MediaStream | null, { position = null, capture = null }: { position?: (() => number) | null, capture?: RecordingCapture | null } = {}) {
    this.stream = stream;
    this.position = position;
    this.capture = capture;
    this.startPos = 0;
    this.mediaRecorder = null;
    this.chunks = [];
    this.metadata = {};
    this.clientNotes = [];
    this.delays = [];   // the singing delay taken off the notes, each time it changed: { t, d, src }
    this.startTime = 0;
    this.isRecording = false;
    this.preferredMimeType = getPreferredMimeType();
    // The recording pauses with the song (setPaused); paused time is left out of the duration
    this.paused = false;
    this.pausedAt = 0;
    this.pausedTotal = 0;
  }

  /** Start recording user singing for the current song. */
  start(songMeta: RecordingMeta = {}): boolean {
    if (typeof MediaRecorder === 'undefined' || !this.stream) return false;
    if (this.isRecording) this.stopAndUpload();

    this.chunks = [];
    this.clientNotes = [];
    this.delays = [];
    this.metadata = { ...songMeta };
    this.startTime = performance.now();
    this.startPos = this.position ? this.position() : 0;
    this.pausedAt = 0;
    this.pausedTotal = 0;

    const options: MediaRecorderOptions = { audioBitsPerSecond: 128000 };
    if (this.preferredMimeType) options.mimeType = this.preferredMimeType;

    try {
      this.mediaRecorder = new MediaRecorder(this.stream, options);
    } catch {
      try {
        this.mediaRecorder = new MediaRecorder(this.stream);
      } catch (err) {
        console.warn('[audio-recorder] Failed to create MediaRecorder:', (err as Error).message);
        this.isRecording = false;
        return false;
      }
    }

    // Collect into this recorder's own array rather than through this.chunks.
    // stop() delivers its last chunk in a later task, by which time starting
    // the next song has already pointed this.chunks at a fresh array -- so the
    // straggler landed at the front of the *next* recording, in front of its
    // EBML header, and ffmpeg refused the file as "Invalid data found when
    // processing input". Bound to the recorder, a late chunk can only ever
    // reach the recording it belongs to.
    const chunks = this.chunks;
    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };

    try {
      this.mediaRecorder.start(1000);
      this.isRecording = true;
      this.applyPause();
      return true;
    } catch (err) {
      console.warn('[audio-recorder] Failed to start MediaRecorder:', (err as Error).message);
      this.isRecording = false;
      return false;
    }
  }

  /**
   * Pause / resume the recording (the song is paused / running again). The
   * flag outlives a single song: a recording started while paused begins
   * paused and only captures audio once the song runs.
   */
  setPaused(paused: boolean): void {
    this.paused = !!paused;
    this.applyPause();
  }

  applyPause(): void {
    const rec = this.mediaRecorder;
    if (!this.isRecording || !rec) return;
    try {
      if (this.paused && rec.state === 'recording') {
        rec.pause();
        this.pausedAt = performance.now();
      } else if (!this.paused && rec.state === 'paused') {
        rec.resume();
        this.pausedTotal += performance.now() - this.pausedAt;
        this.pausedAt = 0;
      }
    } catch (err) {
      console.warn('[audio-recorder] Failed to pause/resume MediaRecorder:', (err as Error).message);
    }
  }

  /**
   * The party's server named the play of `songId` (when its song started,
   * ms): the take of that song keeps it, so the singer's profile finds the
   * take by the play's saved score. It may come before or after the
   * recording started; another song's start leaves this take alone.
   */
  notePlayStart(songId: string | null | undefined, startedAt: number): void {
    if (this.isRecording && songId && this.metadata.songId === songId && Number.isFinite(startedAt)) {
      this.metadata.playStartedAt = startedAt;
    }
  }

  /**
   * Stop recording and keep nothing ("Save recordings" was switched off):
   * the audio so far is dropped, not uploaded.
   */
  discard(): void {
    if (!this.isRecording || !this.mediaRecorder) return;
    this.isRecording = false;
    const recorder = this.mediaRecorder;
    recorder.ondataavailable = null;
    recorder.onstop = null;
    try { if (recorder.state !== 'inactive') recorder.stop(); } catch { /* already stopped */ }
    this.chunks = [];
    this.clientNotes = [];
    this.delays = [];
    this.pausedAt = 0;
    this.pausedTotal = 0;
  }

  /**
   * One detected window: the video time it was scored at, its pitch (0 =
   * none), level, consonant flag and `pos`, where the window ends on the
   * capture's clock. Every window is kept (up to MAX_NOTES), with the pitch as
   * detected; `held`: the singing gate held it back as talking (singingGate.js;
   * it may still have counted, if the gate opened within 2 s).
   */
  recordNote({ videoTime, freq, volume, fric = 0, pos, delay, delaySource, held = false }: RecordedWindow): void {
    if (!this.isRecording || this.clientNotes.length >= MAX_NOTES) return;
    // `t` stays the stamp as it came; the delay scored with is logged when it
    // moves by 5 ms or more (or its source changes), so t - d is what was judged
    if (typeof delay === 'number') {
      const last = this.delays[this.delays.length - 1];
      if (!last || Math.abs(last.d - delay) >= 0.005 || last.src !== delaySource) {
        this.delays.push({ t: Math.round(videoTime * 1000) / 1000, d: Math.round(delay * 1000) / 1000, src: delaySource ?? null });
      }
    }
    const note: ClientNote = {
      t: Math.round(videoTime * 1000) / 1000,
      f: Math.round(freq * 10) / 10,
      v: Math.round(volume * 1000) / 1000,
    };
    // where in this recording's audio the window ends (s)
    if (typeof pos === 'number' && this.position) note.a = Math.round((pos - this.startPos) * 1000) / 1000;
    if (fric) note.c = 1; // a hissed consonant (fricative.js), only when there was one
    if (held) note.h = 1; // held back by the singing gate, only when it was
    this.clientNotes.push(note);
  }

  /** Stop recording and upload the audio and telemetry. */
  stopAndUpload(extra: RecordingExtra = {}): Promise<RecordingUploadResult | null> {
    if (!this.isRecording || !this.mediaRecorder) return Promise.resolve(null);
    this.isRecording = false;

    const recorder = this.mediaRecorder;
    const chunks = this.chunks;
    const clientNotes = this.clientNotes;
    const delays = this.delays;
    const metadata = this.metadata;
    const now = performance.now();
    const pausedMs = this.pausedTotal + (this.pausedAt ? now - this.pausedAt : 0);
    const duration = (now - this.startTime - pausedMs) / 1000; // audio actually recorded
    this.pausedAt = 0;
    this.pausedTotal = 0;

    return new Promise<RecordingUploadResult | null>((resolve) => {
      recorder.onstop = async () => {
        try {
          const mimeType = recorder.mimeType || this.preferredMimeType || 'audio/webm';
          const blob = new Blob(chunks, { type: mimeType });

          if (duration < 3 || blob.size < 1000) {
            resolve(null);
            return;
          }

          const track = this.stream?.getAudioTracks?.()[0];
          const settings: MediaTrackSettings = track?.getSettings?.() || {};

          const payload = {
            ...metadata,
            score: extra.score ?? metadata.score ?? null,
            serverScore: extra.serverScore ?? null,
            part: extra.part ?? null,
            gapAtEnd: extra.gapAtEnd ?? null,
            duration: Math.round(duration * 10) / 10,
            mimeType,
            sampleRate: settings.sampleRate || null,
            channelCount: settings.channelCount || null,
            device: {
              userAgent: navigator.userAgent,
              platform: navigator.platform,
              isMobile: /iPhone|iPad|iPod|Android/i.test(navigator.userAgent),
            },
            capture: this.capture,
            // 2: notes carry `a` (their place in the audio) and every window is kept
            notesVersion: 2,
            truncated: clientNotes.length >= MAX_NOTES,
            delays,
            clientNotes,
          };

          const formData = new FormData();
          const ext = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'mp4' : 'webm';
          formData.append('audio', blob, `recording.${ext}`);
          formData.append('metadata', JSON.stringify(payload));

          const res = await fetch(`${apiUrl}/recordings`, {
            method: 'POST',
            body: formData,
          });

          if (res.ok) {
            const result = await res.json() as RecordingUploadResult;
            resolve(result);
          } else {
            resolve(null);
          }
        } catch (err) {
          console.warn('[audio-recorder] Upload failed:', err);
          resolve(null);
        }
      };

      try {
        if (recorder.state !== 'inactive') recorder.stop();
        else (recorder.onstop as () => void)(); // our own handler, set just above
      } catch {
        resolve(null);
      }
    });
  }
}

