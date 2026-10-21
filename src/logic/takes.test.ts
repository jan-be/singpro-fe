import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { UserAudioRecorder } from './AudioRecorder';
import { loadSaveRecordings, storeSaveRecordings, makeShareVideo, deleteTake, takeAudioBlob, takeAudioUrl } from './takes';

// Node's name for the global object (the tests run in Node; the page's lib does not know it)
declare const global: typeof globalThis;
/** What the stand-ins for fetch below are called with */
type FetchInit = { method: string; body: FormData };

describe('Save recordings switch', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    globalThis.localStorage = { getItem: (k: string) => (store.has(k) ? store.get(k) : null), setItem: (k: string, v: string) => store.set(k, String(v)) } as unknown as Storage;
  });
  afterEach(() => { delete (globalThis as { localStorage?: Storage }).localStorage; });

  it('is on unless it was turned off, and remembers the choice', () => {
    expect(loadSaveRecordings()).toBe(true);
    storeSaveRecordings(false);
    expect(loadSaveRecordings()).toBe(false);
    storeSaveRecordings(true);
    expect(loadSaveRecordings()).toBe(true);
  });

  it('is on where the browser keeps no storage', () => {
    globalThis.localStorage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } } as unknown as Storage;
    expect(loadSaveRecordings()).toBe(true);
    expect(() => storeSaveRecordings(false)).not.toThrow();
  });
});

describe('the take a recorder keeps', () => {
  let uploads: unknown[];
  beforeEach(() => {
    uploads = [];
    global.MediaRecorder = class {
      declare mimeType: string;
      declare state: string;
      declare ondataavailable?: (e: { data: Blob }) => void;
      declare onstop?: () => void;
      static isTypeSupported() { return true; }
      constructor(stream: unknown, options: { mimeType?: string } = {}) { this.mimeType = options.mimeType || 'audio/webm;codecs=opus'; this.state = 'inactive'; }
      start() { this.state = 'recording'; this.ondataavailable?.({ data: new Blob([new Uint8Array(6000)]) }); }
      stop() { this.state = 'inactive'; this.onstop?.(); }
      pause() { this.state = 'paused'; }
      resume() { this.state = 'recording'; }
    } as unknown as typeof MediaRecorder;
    global.fetch = vi.fn(async (url: string, options: FetchInit) => {
      uploads.push(JSON.parse(options.body.get('metadata') as string));
      return { ok: true, json: async () => ({ success: true, recordingId: 'rec-1', token: 'tok' }) };
    }) as unknown as typeof fetch;
  });
  afterEach(() => { delete (global as { fetch?: typeof fetch }).fetch; });
  const stream = { getAudioTracks: () => [{ getSettings: () => ({}) }] } as unknown as MediaStream;

  it('names the play its song started in, whether the server said so before or after it started', async () => {
    const recorder = new UserAudioRecorder(stream);
    recorder.start({ songId: 'a', save: true, guestId: 'guest-1234', playStartedAt: null });
    recorder.notePlayStart('b', 111); // another song's start: not this take's
    expect(recorder.metadata.playStartedAt).toBe(null);
    recorder.notePlayStart('a', 222);
    recorder.startTime = performance.now() - 5000;
    const answer = await recorder.stopAndUpload({});
    expect(answer).toEqual({ success: true, recordingId: 'rec-1', token: 'tok' });
    expect(uploads[0]).toMatchObject({ songId: 'a', save: true, guestId: 'guest-1234', playStartedAt: 222 });
  });

  it('drops the take when "Save recordings" is switched off: nothing is uploaded', async () => {
    const recorder = new UserAudioRecorder(stream);
    recorder.start({ songId: 'a', save: true });
    recorder.recordNote({ videoTime: 1, freq: 220, volume: 0.1 });
    recorder.discard();
    expect(recorder.isRecording).toBe(false);
    expect(recorder.clientNotes).toEqual([]);
    expect(await recorder.stopAndUpload({})).toBe(null);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('takes API', () => {
  afterEach(() => { delete (global as { fetch?: typeof fetch }).fetch; });

  it('makes the share video from the take\'s token and the score picture', async () => {
    let sent = null as { url: string; init: FetchInit } | null;
    global.fetch = vi.fn(async (url: string, init: FetchInit) => { sent = { url, init }; return { ok: true, blob: async () => new Blob(['mp4'], { type: 'video/mp4' }) }; }) as unknown as typeof fetch;
    const blob = await makeShareVideo({ recordingId: 'rec 1', token: 'tok', image: new Blob(['jpg'], { type: 'image/jpeg' }) });
    expect(blob.type).toBe('video/mp4');
    expect(sent!.url).toBe('/api/takes/rec%201/clip');
    expect(sent!.init.method).toBe('POST');
    expect(sent!.init.body.get('token')).toBe('tok');
    expect(sent!.init.body.get('image')).toBeInstanceOf(Blob);
  });

  it('sends the animated card\'s pictures and layout along when it has them', async () => {
    let body = null as FormData | null;
    global.fetch = vi.fn(async (url: string, init: FetchInit) => { body = init.body; return { ok: true, blob: async () => new Blob(['mp4'], { type: 'video/mp4' }) }; }) as unknown as typeof fetch;
    const layout = { wave: { x: 72, y: 1384, w: 936, h: 123 }, fill: 640, count: { x: 240, y: 1023, w: 432, h: 322, frames: 18 } };
    await makeShareVideo({ recordingId: 'r', image: new Blob(['jpg']), overlay: new Blob(['png']), count: new Blob(['webp'], { type: 'image/webp' }), layout });
    expect(body!.get('overlay')).toBeInstanceOf(Blob);
    expect(body!.get('count')).toBeInstanceOf(Blob);
    expect(JSON.parse(body!.get('layout') as string)).toEqual(layout);
    // the card alone: no layers sent
    await makeShareVideo({ recordingId: 'r', image: new Blob(['jpg']) });
    expect(body!.get('overlay')).toBe(null);
    expect(body!.get('layout')).toBe(null);
  });

  it('fetches a take\'s audio for sharing at the address it plays from, and says why when it cannot', async () => {
    global.fetch = vi.fn(async (url: string) => ({ ok: true, blob: async () => new Blob(['m4a'], { type: 'audio/mp4' }), url })) as unknown as typeof fetch;
    const blob = await takeAudioBlob('abc', 2);
    expect(fetch).toHaveBeenCalledWith('/api/takes/abc/audio?v=2', { method: 'GET' });
    expect(blob.type).toBe('audio/mp4');
    global.fetch = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({ success: false, code: 'take_unknown', error: 'No such recording' }) })) as unknown as typeof fetch;
    await expect(takeAudioBlob('gone', 2)).rejects.toMatchObject({ code: 'take_unknown', status: 404 });
  });

  it('passes the server\'s reason on when the video cannot be made', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 422, json: async () => ({ success: false, code: 'no_moment', error: 'No sung moment' }) })) as unknown as typeof fetch;
    await expect(makeShareVideo({ recordingId: 'r', token: 't', image: new Blob() })).rejects.toMatchObject({ code: 'no_moment', status: 422 });
  });

  it('deletes a take and points the player at your own take\'s mix', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ success: true }) })) as unknown as typeof fetch;
    await deleteTake('abc');
    expect(fetch).toHaveBeenCalledWith('/api/me/takes/abc', { method: 'DELETE' });
    expect(takeAudioUrl('abc')).toBe('/api/takes/abc/audio');
    expect(takeAudioUrl('abc', 2)).toBe('/api/takes/abc/audio?v=2');
  });
});
