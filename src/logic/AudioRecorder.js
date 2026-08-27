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

export class UserAudioRecorder {
  constructor(stream) {
    this.stream = stream;
    this.mediaRecorder = null;
    this.chunks = [];
    this.metadata = {};
    this.clientNotes = [];
    this.startTime = 0;
    this.isRecording = false;
    this.preferredMimeType = getPreferredMimeType();
    this.lastNoteTime = 0;
  }

  /** Start recording user singing for the current song. */
  start(songMeta = {}) {
    if (typeof MediaRecorder === 'undefined' || !this.stream) return false;
    if (this.isRecording) this.stopAndUpload();

    this.chunks = [];
    this.clientNotes = [];
    this.metadata = { ...songMeta };
    this.startTime = performance.now();
    this.lastNoteTime = 0;

    const options = { audioBitsPerSecond: 128000 };
    if (this.preferredMimeType) options.mimeType = this.preferredMimeType;

    try {
      this.mediaRecorder = new MediaRecorder(this.stream, options);
    } catch {
      try {
        this.mediaRecorder = new MediaRecorder(this.stream);
      } catch (err) {
        console.warn('[audio-recorder] Failed to create MediaRecorder:', err.message);
        this.isRecording = false;
        return false;
      }
    }

    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this.chunks.push(e.data);
    };

    try {
      this.mediaRecorder.start(1000);
      this.isRecording = true;
      return true;
    } catch (err) {
      console.warn('[audio-recorder] Failed to start MediaRecorder:', err.message);
      this.isRecording = false;
      return false;
    }
  }

  /** Record detected pitch sample for telemetry pairing. */
  recordNote({ videoTime, freq, volume }) {
    if (!this.isRecording) return;
    const now = performance.now();
    if (now - this.lastNoteTime < 20) return; // throttle to ~50/sec
    this.lastNoteTime = now;

    if (this.clientNotes.length < 15000) {
      this.clientNotes.push({
        t: Math.round(videoTime * 100) / 100,
        f: Math.round(freq * 10) / 10,
        v: Math.round(volume * 1000) / 1000,
      });
    }
  }

  /** Stop recording and upload the audio and telemetry. */
  stopAndUpload(extra = {}) {
    if (!this.isRecording || !this.mediaRecorder) return Promise.resolve(null);
    this.isRecording = false;

    const recorder = this.mediaRecorder;
    const chunks = this.chunks;
    const clientNotes = this.clientNotes;
    const metadata = this.metadata;
    const duration = (performance.now() - this.startTime) / 1000;

    return new Promise((resolve) => {
      recorder.onstop = async () => {
        try {
          const mimeType = recorder.mimeType || this.preferredMimeType || 'audio/webm';
          const blob = new Blob(chunks, { type: mimeType });

          if (duration < 3 || blob.size < 1000) {
            resolve(null);
            return;
          }

          const track = this.stream?.getAudioTracks?.()[0];
          const settings = track?.getSettings?.() || {};

          const payload = {
            ...metadata,
            score: extra.score ?? metadata.score ?? null,
            duration: Math.round(duration * 10) / 10,
            mimeType,
            sampleRate: settings.sampleRate || null,
            channelCount: settings.channelCount || null,
            device: {
              userAgent: navigator.userAgent,
              platform: navigator.platform,
              isMobile: /iPhone|iPad|iPod|Android/i.test(navigator.userAgent),
            },
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
            const result = await res.json();
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
        else recorder.onstop();
      } catch {
        resolve(null);
      }
    });
  }
}

