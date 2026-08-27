import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { UserAudioRecorder } from './AudioRecorder';

describe('UserAudioRecorder', () => {
  let mockStream;
  let mockTrack;

  beforeEach(() => {
    mockTrack = {
      readyState: 'live',
      getSettings: () => ({ sampleRate: 48000, channelCount: 2 }),
      stop: vi.fn(),
    };
    mockStream = {
      getAudioTracks: () => [mockTrack],
    };

    // Global MediaRecorder mock
    global.MediaRecorder = class MockMediaRecorder {
      static isTypeSupported(type) {
        return type.includes('opus') || type.includes('webm');
      }

      constructor(stream, options = {}) {
        this.stream = stream;
        this.options = options;
        this.mimeType = options.mimeType || 'audio/webm;codecs=opus';
        this.state = 'inactive';
        this.ondataavailable = null;
        this.onstop = null;
        this.onerror = null;
      }

      start(timeslice) {
        this.state = 'recording';
        if (this.ondataavailable) {
          const fakeChunk = new Blob(['mock-audio-chunk-data-1234567890'], { type: this.mimeType });
          this.ondataavailable({ data: fakeChunk });
        }
      }

      stop() {
        this.state = 'inactive';
        if (this.onstop) {
          this.onstop();
        }
      }

      pause() {
        this.state = 'paused';
      }

      resume() {
        this.state = 'recording';
      }
    };
  });

  it('initializes with stream and detects preferred mimeType', () => {
    const recorder = new UserAudioRecorder(mockStream);
    expect(recorder.stream).toBe(mockStream);
    expect(recorder.preferredMimeType).toContain('webm');
    expect(recorder.isRecording).toBe(false);
  });

  it('starts recording and captures metadata', () => {
    const recorder = new UserAudioRecorder(mockStream);
    const started = recorder.start({
      songId: 'test-song-1',
      artist: 'Test Artist',
      title: 'Test Song',
      gap: 1200,
      bpm: 120,
    });

    expect(started).toBe(true);
    expect(recorder.isRecording).toBe(true);
    expect(recorder.metadata.songId).toBe('test-song-1');
  });

  it('records pitch notes with throttling', () => {
    const recorder = new UserAudioRecorder(mockStream);
    recorder.start({ songId: 'test-song-1' });

    recorder.recordNote({ videoTime: 1.0, freq: 440, volume: 0.05 });
    expect(recorder.clientNotes.length).toBe(1);
    expect(recorder.clientNotes[0]).toEqual({ t: 1, f: 440, v: 0.05 });
  });

  it('uploads recording via fetch when stopped', async () => {
    const recorder = new UserAudioRecorder(mockStream);
    recorder.start({
      songId: 'test-song-1',
      artist: 'Test Artist',
      title: 'Test Song',
    });

    // Mock fetch
    let fetchCalledWith = null;
    global.fetch = vi.fn().mockImplementation(async (url, options) => {
      fetchCalledWith = { url, options };
      return {
        ok: true,
        json: async () => ({ success: true, recordingId: 'mock-rec-id' }),
      };
    });

    // Artificially simulate 5 seconds duration
    recorder.startTime = performance.now() - 5500;
    // Add chunk data large enough to exceed 5KB
    const largeChunk = new Uint8Array(6000);
    recorder.chunks = [new Blob([largeChunk], { type: 'audio/webm;codecs=opus' })];

    const result = await recorder.stopAndUpload({ score: 9500 });

    expect(result).toEqual({ success: true, recordingId: 'mock-rec-id' });
    expect(fetchCalledWith).not.toBeNull();
    expect(fetchCalledWith.url).toContain('/recordings');
    expect(fetchCalledWith.options.method).toBe('POST');
    expect(fetchCalledWith.options.body).toBeInstanceOf(FormData);
  });

  it('discards recordings under 3 seconds', async () => {
    const recorder = new UserAudioRecorder(mockStream);
    recorder.start({ songId: 'test-song-1' });

    // Duration is < 3 seconds
    recorder.startTime = performance.now() - 1000;
    const result = await recorder.stopAndUpload({ score: 100 });

    expect(result).toBeNull();
  });
});
