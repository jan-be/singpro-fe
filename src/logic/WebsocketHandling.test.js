import { describe, it, expect } from 'vitest';
import { BIN_PLAYER_NOTE, BIN_NOTES_BATCH, sendPlayerNote, parseBinaryBatch } from './WebsocketHandling.js';

describe('Binary WebSocket protocol', () => {
  describe('sendPlayerNote', () => {
    it('sends a 9-byte ArrayBuffer with correct header and payload', () => {
      let sentData = null;
      const mockWs = { send: data => { sentData = data; } };

      sendPlayerNote(mockWs, { freq: 440.5, videoTime: 12.25 });

      expect(sentData).toBeInstanceOf(ArrayBuffer);
      expect(sentData.byteLength).toBe(9);

      const view = new DataView(sentData);
      expect(view.getUint8(0)).toBe(BIN_PLAYER_NOTE);
      expect(view.getFloat32(1, true)).toBeCloseTo(440.5, 1);
      expect(view.getFloat32(5, true)).toBeCloseTo(12.25, 2);
    });

    it('reuses the same buffer (no allocation per call)', () => {
      let firstBuf = null;
      let secondBuf = null;
      const mockWs = { send: data => { firstBuf = firstBuf ?? data; secondBuf = data; } };

      sendPlayerNote(mockWs, { freq: 220, videoTime: 1.0 });
      sendPlayerNote(mockWs, { freq: 880, videoTime: 2.0 });

      // Same underlying ArrayBuffer reference
      expect(firstBuf).toBe(secondBuf);
    });
  });

  describe('parseBinaryBatch', () => {
    /** Helper: encode a notes batch the same way the server does. */
    function encodeTestBatch(notes) {
      const encoder = new TextEncoder();
      const encodedNames = notes.map(n => encoder.encode(n.username));
      let size = 2; // type + count
      for (const name of encodedNames) size += 1 + name.length + 8;

      const buf = new ArrayBuffer(size);
      const view = new DataView(buf);
      const bytes = new Uint8Array(buf);
      view.setUint8(0, BIN_NOTES_BATCH);
      view.setUint8(1, notes.length);

      let offset = 2;
      for (let i = 0; i < notes.length; i++) {
        const nameBytes = encodedNames[i];
        view.setUint8(offset, nameBytes.length); offset++;
        bytes.set(nameBytes, offset); offset += nameBytes.length;
        view.setFloat32(offset, notes[i].freq, true); offset += 4;
        view.setFloat32(offset, notes[i].videoTime, true); offset += 4;
      }
      return buf;
    }

    it('decodes a single-note batch', () => {
      const buf = encodeTestBatch([{ username: 'jan', freq: 440.5, videoTime: 12.25 }]);
      const result = parseBinaryBatch(buf);

      expect(result.type).toBe('player:notes_batch');
      expect(result.data.notes).toHaveLength(1);
      expect(result.data.notes[0].username).toBe('jan');
      expect(result.data.notes[0].freq).toBeCloseTo(440.5, 1);
      expect(result.data.notes[0].videoTime).toBeCloseTo(12.25, 2);
    });

    it('decodes a multi-note batch with different usernames', () => {
      const notes = [
        { username: 'alice', freq: 261.63, videoTime: 5.0 },
        { username: 'bob', freq: 329.63, videoTime: 5.02 },
        { username: 'alice', freq: 262.0, videoTime: 5.04 },
      ];
      const buf = encodeTestBatch(notes);
      const result = parseBinaryBatch(buf);

      expect(result.data.notes).toHaveLength(3);
      for (let i = 0; i < 3; i++) {
        expect(result.data.notes[i].username).toBe(notes[i].username);
        expect(result.data.notes[i].freq).toBeCloseTo(notes[i].freq, 0);
        expect(result.data.notes[i].videoTime).toBeCloseTo(notes[i].videoTime, 2);
      }
    });

    it('decodes an empty batch', () => {
      const buf = encodeTestBatch([]);
      const result = parseBinaryBatch(buf);
      expect(result.data.notes).toHaveLength(0);
    });

    it('handles unicode usernames', () => {
      const buf = encodeTestBatch([{ username: 'Müller', freq: 440, videoTime: 1.0 }]);
      const result = parseBinaryBatch(buf);
      expect(result.data.notes[0].username).toBe('Müller');
    });

    it('preserves Float32 precision for freq and videoTime', () => {
      // Float32 has ~7 digits of precision
      const freq = 1046.5; // C6
      const videoTime = 245.375;
      const buf = encodeTestBatch([{ username: 'x', freq, videoTime }]);
      const result = parseBinaryBatch(buf);
      // Float32 round-trip should be exact for values representable in float32
      expect(result.data.notes[0].freq).toBeCloseTo(freq, 1);
      expect(result.data.notes[0].videoTime).toBeCloseTo(videoTime, 2);
    });
  });
});
