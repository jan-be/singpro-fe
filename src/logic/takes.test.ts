import { describe, it, expect, vi, beforeEach, afterEach, assert } from 'vitest';
import { UserAudioRecorder } from './AudioRecorder';
import { loadSaveRecordings, storeSaveRecordings, makeShareVideo, deleteTake, takeAudioBlob, takeAudioUrl } from './takes';

/** What the stand-ins for fetch below are called with */
type FetchInit = { method: string; body: FormData };

afterEach(() => { vi.unstubAllGlobals(); });

describe('Save recordings switch', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, String(v)) });
  });

  it('is on unless it was turned off, and remembers the choice', () => {
    expect(loadSaveRecordings()).toBe(true);
    storeSaveRecordings(false);
    expect(loadSaveRecordings()).toBe(false);
    storeSaveRecordings(true);
    expect(loadSaveRecordings()).toBe(true);
  });

  it('is on where the browser keeps no storage', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
    expect(loadSaveRecordings()).toBe(true);
    expect(() => storeSaveRecordings(false)).not.toThrow();
  });
});

describe('the take a recorder keeps', () => {
  let uploads: unknown[];
  beforeEach(() => {
    uploads = [];
    vi.stubGlobal('MediaRecorder', class {
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
    });
    // the microphone's stream: the recorder only asks it for its track's settings
    vi.stubGlobal('MediaStream', class { getAudioTracks() { return [{ getSettings: () => ({}) }]; } });
    vi.stubGlobal('fetch', vi.fn(async (url: string, options: FetchInit) => {
      uploads.push(JSON.parse(String(options.body.get('metadata'))));
      return { ok: true, json: async () => ({ success: true, recordingId: 'rec-1', token: 'tok' }) };
    }));
  });

  it('names the play its song started in, whether the server said so before or after it started', async () => {
    const recorder = new UserAudioRecorder(new MediaStream());
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
    const recorder = new UserAudioRecorder(new MediaStream());
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
  /** A stand-in for fetch that answers with an MP4, its calls kept */
  const videoFetch = () => {
    const fake = vi.fn(async (url: string, init: FetchInit) => ({ ok: true, blob: async () => new Blob(['mp4'], { type: 'video/mp4' }) }));
    vi.stubGlobal('fetch', fake);
    return fake;
  };
  /** What the last call was given */
  const lastCall = (fake: ReturnType<typeof videoFetch>) => {
    const call = fake.mock.lastCall;
    assert(call, 'fetch was not called');
    return call;
  };
  const lastBody = (fake: ReturnType<typeof videoFetch>) => lastCall(fake)[1].body;

  it('makes the share video from the take\'s token and the score picture', async () => {
    const fake = videoFetch();
    const blob = await makeShareVideo({ recordingId: 'rec 1', token: 'tok', image: new Blob(['jpg'], { type: 'image/jpeg' }) });
    expect(blob.type).toBe('video/mp4');
    const [url, init] = lastCall(fake);
    expect(url).toBe('/api/takes/rec%201/clip');
    expect(init.method).toBe('POST');
    expect(init.body.get('token')).toBe('tok');
    expect(init.body.get('image')).toBeInstanceOf(Blob);
  });

  it('sends the animated card\'s pictures and layout along when it has them', async () => {
    const fake = videoFetch();
    const layout = { wave: { x: 72, y: 1384, w: 936, h: 123 }, fill: 640, count: { x: 240, y: 1023, w: 432, h: 322, frames: 18 } };
    await makeShareVideo({ recordingId: 'r', image: new Blob(['jpg']), overlay: new Blob(['png']), count: new Blob(['webp'], { type: 'image/webp' }), layout });
    expect(lastBody(fake).get('overlay')).toBeInstanceOf(Blob);
    expect(lastBody(fake).get('count')).toBeInstanceOf(Blob);
    expect(JSON.parse(String(lastBody(fake).get('layout')))).toEqual(layout);
    // the card alone: no layers sent
    await makeShareVideo({ recordingId: 'r', image: new Blob(['jpg']) });
    expect(lastBody(fake).get('overlay')).toBe(null);
    expect(lastBody(fake).get('layout')).toBe(null);
  });

  it('fetches a take\'s audio for sharing at the address it plays from, and says why when it cannot', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, blob: async () => new Blob(['m4a'], { type: 'audio/mp4' }), url })));
    const blob = await takeAudioBlob('abc', 2);
    expect(fetch).toHaveBeenCalledWith('/api/takes/abc/audio?v=2', { method: 'GET' });
    expect(blob.type).toBe('audio/mp4');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({ success: false, code: 'take_unknown', error: 'No such recording' }) })));
    await expect(takeAudioBlob('gone', 2)).rejects.toMatchObject({ code: 'take_unknown', status: 404 });
  });

  it('passes the server\'s reason on when the video cannot be made', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 422, json: async () => ({ success: false, code: 'no_moment', error: 'No sung moment' }) })));
    await expect(makeShareVideo({ recordingId: 'r', token: 't', image: new Blob() })).rejects.toMatchObject({ code: 'no_moment', status: 422 });
  });

  it('deletes a take and points the player at your own take\'s mix', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ success: true }) })));
    await deleteTake('abc');
    expect(fetch).toHaveBeenCalledWith('/api/me/takes/abc', { method: 'DELETE' });
    expect(takeAudioUrl('abc')).toBe('/api/takes/abc/audio');
    expect(takeAudioUrl('abc', 2)).toBe('/api/takes/abc/audio?v=2');
  });
});
