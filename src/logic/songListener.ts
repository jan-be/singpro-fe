/**
 * One listen of the entry page's listen button: the microphone, a few
 * seconds, and the song that is playing in the room (singspree-be
 * recognize/recognizer.js).
 *
 * The microphone opens when listen() is called (the button) and closes as
 * soon as there is an answer, after 12 s, on stop(), or when the tab goes to
 * the background — it is never open for anything else. Its audio goes to the
 * server a second at a time as 16 kHz PCM; the server keeps it only while it
 * looks and drops it with the answer.
 *
 *   const l = listen({ onOpen, onLevel, onHeard }); // the mic is open; its level; seconds heard so far
 *   const { status, results, error } = await l.done; // 'found' | 'none' | 'stopped' | 'error'
 *   l.stop();
 */
import { apiUrl } from '../GlobalConsts';
import { openMicCapture, micErrorKind } from './MicrophoneInput';
import { HOP_SAMPLES } from './pitchModel';

export const RATE = 16000;
export const MAX_SECONDS = 12;
const SEND_EVERY = RATE; // a second of audio per request
const GIVE_UP_MS = 20_000; // no answer this long after listening began (a slow network): stop

/** A song the server heard (POST /recognize/:id): which, where in it (offset, s) and how sure (z) */
export interface RecognizedSong {
  songId: string;
  offset: number;
  at: number;
  z: number;
  title: string;
  artist: string;
  videoId: string;
  titles?: Record<string, { title?: string; artist?: string }> | null;
  hasStems: boolean;
}

/** How a listen ended (listen().done) */
export interface ListenResult {
  status: 'found' | 'none' | 'stopped' | 'error';
  results?: RecognizedSong[];
  /** seconds the server heard */
  heard?: number;
  /** 'rate' | 'off' | 'busy' | 'failed' | 'network', or the microphone's (micErrorKind) */
  error?: string;
}

/** listen()'s callbacks: the mic is open; its level; seconds heard so far */
export interface ListenOptions {
  onOpen?: () => void;
  onLevel?: (volume: number) => void;
  onHeard?: (seconds: number) => void;
  fetchImpl?: typeof fetch;
}

/** A listen going on */
export interface Listening {
  done: Promise<ListenResult>;
  stop(): void;
}

/** What the server answers about a listen */
interface RecognizeBody {
  code?: string;
  status?: string;
  results?: RecognizedSong[];
  heard?: number;
}

type MicCapture = Awaited<ReturnType<typeof openMicCapture>>;

/** Float samples to 16-bit PCM */
export function toPcm16(samples: ArrayLike<number>): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    out[i] = v < 0 ? v * 32768 : v * 32767;
  }
  return out;
}

/**
 * Collects the capture's chunks (each HOP_SAMPLES newer than the last) into
 * one stream and hands out what has not been sent yet.
 */
export function createPcmBuffer(max = MAX_SECONDS * RATE) {
  const all = new Int16Array(max);
  let n = 0, sent = 0;
  return {
    push(chunk: Float32Array) {
      const fresh = chunk.length > HOP_SAMPLES ? chunk.subarray(chunk.length - HOP_SAMPLES) : chunk;
      const take = Math.min(fresh.length, max - n);
      if (take > 0) all.set(toPcm16(fresh.subarray(0, take)), n);
      n += Math.max(0, take);
    },
    get length() { return n; },
    get unsent() { return n - sent; },
    full: () => n >= max,
    take() { const part = all.slice(sent, n); sent = n; return part; },
  };
}

export function listen({ onOpen, onLevel, onHeard, fetchImpl = fetch }: ListenOptions = {}): Listening {
  let stopped = false;
  let finish: (result: ListenResult) => void;
  const done = new Promise<ListenResult>(resolve => { finish = resolve; });
  let stream: MediaStream | null = null, capture: MicCapture | null = null, id: string | null = null, inFlight = false, giveUp: ReturnType<typeof setTimeout> | null = null, wantFinal = false, heardAt = 0;
  const buf = createPcmBuffer();

  const closeMic = () => {
    try { capture?.stop(); } catch { /* */ }
    try { stream?.getTracks().forEach(t => t.stop()); } catch { /* */ }
    capture = null;
    stream = null;
  };
  const end = (result: ListenResult) => {
    if (stopped) return;
    stopped = true;
    clearTimeout(giveUp);
    document.removeEventListener('visibilitychange', onHidden);
    closeMic();
    finish(result);
  };
  const cancelOnServer = () => {
    if (id) fetchImpl(`${apiUrl}/recognize/${id}`, { method: 'DELETE', keepalive: true }).catch(() => {});
  };
  // a hidden tab never keeps the microphone (the mic standby rule)
  const onHidden = () => {
    if (document.visibilityState === 'hidden') { cancelOnServer(); end({ status: 'stopped' }); }
  };
  document.addEventListener('visibilitychange', onHidden);

  const send = async (final = false) => {
    if (final) wantFinal = true;
    if (inFlight || stopped || !id) return;
    final = wantFinal;
    if (!final && buf.unsent < SEND_EVERY && !buf.full()) return;
    inFlight = true;
    const body = buf.take();
    try {
      const r = await fetchImpl(`${apiUrl}/recognize/${id}${final || buf.full() ? '?final=1' : ''}`, {
        method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body,
      });
      const j: RecognizeBody = await r.json().catch(() => ({}));
      if (stopped) return;
      if (!r.ok) { end({ status: 'error', error: j.code === 'rate' ? 'rate' : 'failed' }); return; }
      if (j.status === 'found') { end({ status: 'found', results: j.results ?? [], heard: j.heard }); return; }
      if (j.status === 'none') { end({ status: 'none', heard: j.heard }); return; }
    } catch {
      if (!stopped) { end({ status: 'error', error: 'network' }); return; }
    } finally {
      inFlight = false;
    }
    // audio that came in while that request ran, or the last look stop() asked for
    if (!stopped && (wantFinal || buf.unsent >= SEND_EVERY || buf.full())) send();
  };

  (async () => {
    try {
      const [s, start] = await Promise.all([
        navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, autoGainControl: false, noiseSuppression: false } }),
        fetchImpl(`${apiUrl}/recognize`, { method: 'POST' }).then(async (r): Promise<{ ok: boolean; id?: string; code?: string }> => ({ ok: r.ok, ...(await r.json().catch(() => ({}))) })),
      ]);
      stream = s;
      if (stopped) { closeMic(); return; }
      if (!start.ok || !start.id) {
        closeMic();
        end({ status: 'error', error: start.code === 'rate' ? 'rate' : start.code === 'off' ? 'off' : 'busy' });
        return;
      }
      id = start.id;
      capture = await openMicCapture(stream);
      if (stopped) { closeMic(); cancelOnServer(); return; }
      onOpen?.();
      capture.setOnChunk(({ audio, volume }: { audio?: Float32Array | null; volume?: number | null }) => {
        if (stopped) return;
        if (volume != null) onLevel?.(volume);
        if (!audio) return;
        buf.push(audio);
        const now = performance.now();
        if (now - heardAt >= 250) { heardAt = now; onHeard?.(buf.length / RATE); }
        if (buf.full()) closeMic(); // all the server takes: the microphone can go now
        send();
      });
      giveUp = setTimeout(() => { cancelOnServer(); end({ status: 'none' }); }, GIVE_UP_MS);
    } catch (e) {
      closeMic();
      end({ status: 'error', error: (e as Error | null)?.name ? micErrorKind(e as Error) : 'failed' });
    }
  })();

  return {
    done,
    /** Stop listening: with 3 s or more heard, the server takes a last look */
    stop() {
      if (stopped) return;
      closeMic();
      if (id && buf.length >= 3 * RATE) { send(true); return; }
      cancelOnServer();
      end({ status: 'stopped' });
    },
  };
}
