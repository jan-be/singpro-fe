import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import { UserAudioRecorder } from './AudioRecorder';

// Node's name for the global object (the tests run in Node; the page's lib does not know it)
declare const global: typeof globalThis;
/** The fetch stand-in, as the test reads its calls */
type FetchMock = Mock<(url: string, init: { body: FormData }) => Promise<unknown>>;

// MediaRecorder stand-in with the real pause/resume state machine
class MockMediaRecorder {
  declare stream: unknown;
  declare mimeType: string;
  declare state: string;
  declare ondataavailable: ((e: { data: Blob }) => void) | null;
  declare onstop: (() => void) | null;
  declare pauses: number;
  declare resumes: number;
  static isTypeSupported() { return true; }
  constructor(stream: unknown, options: { mimeType?: string } = {}) {
    this.stream = stream;
    this.mimeType = options.mimeType || 'audio/webm;codecs=opus';
    this.state = 'inactive';
    this.ondataavailable = null;
    this.onstop = null;
    this.pauses = 0;
    this.resumes = 0;
  }
  start() {
    this.state = 'recording';
    this.ondataavailable?.({ data: new Blob(['x'.repeat(2000)], { type: this.mimeType }) });
  }
  pause() {
    if (this.state !== 'recording') throw new Error('InvalidStateError');
    this.state = 'paused';
    this.pauses++;
  }
  resume() {
    if (this.state !== 'paused') throw new Error('InvalidStateError');
    this.state = 'recording';
    this.resumes++;
  }
  stop() {
    this.state = 'inactive';
    this.onstop?.();
  }
}

describe('UserAudioRecorder pauses with the song', () => {
  let now: number;
  const stream = { getAudioTracks: () => [{ getSettings: () => ({ sampleRate: 48000, channelCount: 1 }) }] } as unknown as MediaStream;
  const uploadedMeta = () => JSON.parse((global.fetch as unknown as FetchMock).mock.calls[0][1].body.get('metadata') as string);

  beforeEach(() => {
    now = 1000;
    global.MediaRecorder = MockMediaRecorder as unknown as typeof MediaRecorder;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ success: true }) })) as unknown as typeof fetch;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete (global as { fetch?: typeof fetch }).fetch;
  });

  it('pauses and resumes the MediaRecorder, once per change', () => {
    const rec = new UserAudioRecorder(stream);
    rec.start({ songId: 's' });
    const mr = rec.mediaRecorder as unknown as MockMediaRecorder;
    rec.setPaused(true);
    expect(mr.state).toBe('paused');
    rec.setPaused(true); // repeated: nothing to do
    expect(mr.pauses).toBe(1);
    rec.setPaused(false);
    expect(mr.state).toBe('recording');
    expect(mr.resumes).toBe(1);
    rec.setPaused(false);
    expect(mr.resumes).toBe(1);
  });

  it('a recording started while the song is paused begins paused', () => {
    const rec = new UserAudioRecorder(stream);
    rec.setPaused(true); // e.g. the next song is cued but not playing yet
    rec.start({ songId: 's' });
    expect(rec.mediaRecorder!.state).toBe('paused');
    rec.setPaused(false);
    expect(rec.mediaRecorder!.state).toBe('recording');
  });

  it('is harmless before any recording started', () => {
    const rec = new UserAudioRecorder(stream);
    expect(() => { rec.setPaused(true); rec.setPaused(false); }).not.toThrow();
  });

  it('leaves paused time out of the uploaded duration', async () => {
    const rec = new UserAudioRecorder(stream);
    rec.start({ songId: 's' });
    now += 5000;   // 5 s sung
    rec.setPaused(true);
    now += 30000;  // 30 s pause
    rec.setPaused(false);
    now += 4000;   // 4 s sung
    await rec.stopAndUpload({ score: 1 });
    expect(uploadedMeta().duration).toBe(9);
  });

  it('counts a pause that is still running when the song ends', async () => {
    const rec = new UserAudioRecorder(stream);
    rec.start({ songId: 's' });
    now += 6000;
    rec.setPaused(true);
    now += 10000;
    await rec.stopAndUpload();
    expect(uploadedMeta().duration).toBe(6);
  });

  it('starts the next song with a clean pause tally', async () => {
    const rec = new UserAudioRecorder(stream);
    rec.start({ songId: 'a' });
    now += 4000;
    rec.setPaused(true);
    now += 20000;
    rec.setPaused(false);
    await rec.stopAndUpload();
    expect(uploadedMeta().duration).toBe(4);

    (global.fetch as unknown as FetchMock).mockClear();
    rec.start({ songId: 'b' });
    now += 7000;
    await rec.stopAndUpload();
    expect(uploadedMeta().duration).toBe(7);
  });
});
