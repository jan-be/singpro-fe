import { describe, it, expect, vi, beforeEach, afterEach, assert } from 'vitest';
import type { Mock } from 'vitest';
import { UserAudioRecorder } from './AudioRecorder';

/** The fetch stand-in, as the test reads its calls */
type FetchFn = (url: string, init: { body: FormData }) => Promise<unknown>;
type FetchMock = Mock<FetchFn>;

// MediaRecorder stand-in with the real pause/resume state machine
class MockMediaRecorder {
  /** the one made last (the recorder's own, as the test reads it) */
  static latest: MockMediaRecorder | null = null;
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
    MockMediaRecorder.latest = this;
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
  let stream: MediaStream;
  let fetchMock: FetchMock;
  const uploadedMeta = () => JSON.parse(String(fetchMock.mock.calls[0][1].body.get('metadata')));

  beforeEach(() => {
    now = 1000;
    vi.stubGlobal('MediaRecorder', MockMediaRecorder);
    // the microphone's stream: the recorder only asks it for its track's settings
    vi.stubGlobal('MediaStream', class { getAudioTracks() { return [{ getSettings: () => ({ sampleRate: 48000, channelCount: 1 }) }]; } });
    stream = new MediaStream();
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    fetchMock = vi.fn<FetchFn>(async () => ({ ok: true, json: async () => ({ success: true }) }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('pauses and resumes the MediaRecorder, once per change', () => {
    const rec = new UserAudioRecorder(stream);
    rec.start({ songId: 's' });
    const mr = MockMediaRecorder.latest;
    assert(mr, 'the recorder made no MediaRecorder');
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
    expect(rec.mediaRecorder?.state).toBe('paused');
    rec.setPaused(false);
    expect(rec.mediaRecorder?.state).toBe('recording');
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

    fetchMock.mockClear();
    rec.start({ songId: 'b' });
    now += 7000;
    await rec.stopAndUpload();
    expect(uploadedMeta().duration).toBe(7);
  });
});
