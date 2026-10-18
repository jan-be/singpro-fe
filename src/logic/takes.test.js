import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { UserAudioRecorder } from './AudioRecorder';
import { loadSaveRecordings, storeSaveRecordings, makeShareVideo, deleteTake, takeAudioUrl } from './takes';

describe('Save recordings switch', () => {
  beforeEach(() => {
    const store = new Map();
    globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
  });
  afterEach(() => { delete globalThis.localStorage; });

  it('is on unless it was turned off, and remembers the choice', () => {
    expect(loadSaveRecordings()).toBe(true);
    storeSaveRecordings(false);
    expect(loadSaveRecordings()).toBe(false);
    storeSaveRecordings(true);
    expect(loadSaveRecordings()).toBe(true);
  });

  it('is on where the browser keeps no storage', () => {
    globalThis.localStorage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(loadSaveRecordings()).toBe(true);
    expect(() => storeSaveRecordings(false)).not.toThrow();
  });
});

describe('the take a recorder keeps', () => {
  let uploads;
  beforeEach(() => {
    uploads = [];
    global.MediaRecorder = class {
      static isTypeSupported() { return true; }
      constructor(stream, options = {}) { this.mimeType = options.mimeType || 'audio/webm;codecs=opus'; this.state = 'inactive'; }
      start() { this.state = 'recording'; this.ondataavailable?.({ data: new Blob([new Uint8Array(6000)]) }); }
      stop() { this.state = 'inactive'; this.onstop?.(); }
      pause() { this.state = 'paused'; }
      resume() { this.state = 'recording'; }
    };
    global.fetch = vi.fn(async (url, options) => {
      uploads.push(JSON.parse(options.body.get('metadata')));
      return { ok: true, json: async () => ({ success: true, recordingId: 'rec-1', token: 'tok' }) };
    });
  });
  afterEach(() => { delete global.fetch; });
  const stream = { getAudioTracks: () => [{ getSettings: () => ({}) }] };

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
  afterEach(() => { delete global.fetch; });

  it('makes the share video from the take\'s token and the score picture', async () => {
    let sent = null;
    global.fetch = vi.fn(async (url, init) => { sent = { url, init }; return { ok: true, blob: async () => new Blob(['mp4'], { type: 'video/mp4' }) }; });
    const blob = await makeShareVideo({ recordingId: 'rec 1', token: 'tok', image: new Blob(['jpg'], { type: 'image/jpeg' }) });
    expect(blob.type).toBe('video/mp4');
    expect(sent.url).toBe('/api/takes/rec%201/clip');
    expect(sent.init.method).toBe('POST');
    expect(sent.init.body.get('token')).toBe('tok');
    expect(sent.init.body.get('image')).toBeInstanceOf(Blob);
  });

  it('passes the server\'s reason on when the video cannot be made', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 422, json: async () => ({ success: false, code: 'no_moment', error: 'No sung moment' }) }));
    await expect(makeShareVideo({ recordingId: 'r', token: 't', image: new Blob() })).rejects.toMatchObject({ code: 'no_moment', status: 422 });
  });

  it('deletes a take and points the player at your own take\'s mix', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ success: true }) }));
    await deleteTake('abc');
    expect(fetch).toHaveBeenCalledWith('/api/me/takes/abc', { method: 'DELETE' });
    expect(takeAudioUrl('abc')).toBe('/api/me/takes/abc/audio');
  });
});
