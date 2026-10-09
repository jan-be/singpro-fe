import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BIN_PLAYER_NOTE, BIN_NOTES_BATCH, sendPlayerNote, sendPartyJoin, sendQueueReorder, sendVideoTime, parseBinaryBatch, parseStanding, reconnectDelay, keepWebSocket,
  sendSongAdvance, sendSongSkip, sendPlaybackControl, sendCohost, sendPartySettings } from './WebsocketHandling.js';
import { getGuestId } from './sessionId';

describe('reconnectDelay', () => {
  it('doubles from half a second up to ten, with ±25 % jitter', () => {
    const mid = () => 0.5;
    expect([0, 1, 2, 3, 4, 5, 6, 30, 2000].map(n => reconnectDelay(n, mid)))
      .toEqual([500, 1000, 2000, 4000, 8000, 10_000, 10_000, 10_000, 10_000]);
    expect(reconnectDelay(0, () => 0)).toBe(375);
    expect(reconnectDelay(0, () => 0.999999)).toBe(625);
    expect(reconnectDelay(9, () => 0)).toBe(7500);
    expect(reconnectDelay(9, () => 0.999999)).toBe(12_500);
  });
});

describe('keepWebSocket', () => {
  /** A socket the test opens, feeds and drops; close() fires `close` at once (browsers do it a little later). */
  class FakeSocket extends EventTarget {
    constructor() { super(); this.readyState = 0; this.closedByPage = false; }
    open() { this.readyState = 1; this.dispatchEvent(new Event('open')); }
    hear() { this.dispatchEvent(new Event('message')); }
    drop() { this.readyState = 3; this.dispatchEvent(new Event('close')); }
    close() { if (this.readyState === 3) return; this.closedByPage = true; this.drop(); }
  }

  let sockets, opened, downs, win, conn;
  const start = () => {
    conn = keepWebSocket({
      onOpen: (ws, info) => opened.push({ ws, ...info }),
      onDown: () => downs++,
      create: () => { const s = new FakeSocket(); sockets.push(s); return s; },
      win,
      random: () => 0.5, // no jitter: the waits are exactly 0.5 s, 1 s, 2 s …
    });
  };
  const last = () => sockets.at(-1);

  beforeEach(() => {
    vi.useFakeTimers();
    sockets = []; opened = []; downs = 0;
    win = new EventTarget();
    win.document = new EventTarget();
    win.document.visibilityState = 'visible';
  });
  afterEach(() => {
    conn?.close();
    vi.useRealTimers();
  });

  it('connects at once and hands every socket that opens to onOpen, saying whether it is a reconnect', () => {
    start();
    expect(sockets).toHaveLength(1);
    last().open();
    expect(opened).toEqual([{ ws: sockets[0], reconnect: false }]);

    sockets[0].drop();
    expect(downs).toBe(1);
    vi.advanceTimersByTime(500);
    expect(sockets).toHaveLength(2);
    last().open();
    expect(opened[1]).toEqual({ ws: sockets[1], reconnect: true });
  });

  it('waits longer after every failed attempt, and from the start again once a connection held', () => {
    start();
    last().open();
    last().drop();                          // open for less than 10 s
    vi.advanceTimersByTime(499);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2);
    last().drop();                          // the server is still down: never opened
    expect(downs).toBe(2);
    vi.advanceTimersByTime(999);
    expect(sockets).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(3);
    last().drop();
    vi.advanceTimersByTime(2000);
    expect(sockets).toHaveLength(4);

    last().open();                          // back, and it holds
    for (let i = 0; i < 3; i++) { vi.advanceTimersByTime(4000); last().hear(); }
    last().drop();
    vi.advanceTimersByTime(500);
    expect(sockets).toHaveLength(5);
  });

  it('never waits more than ten seconds (plus jitter)', () => {
    start();
    for (let i = 0; i < 8; i++) { last().drop(); vi.advanceTimersByTime(10_000); }
    expect(sockets).toHaveLength(9);
  });

  it('closing it for good closes the socket, and nothing reconnects or counts as down', () => {
    start();
    const first = last();
    first.open();
    conn.close();
    expect(first.closedByPage).toBe(true);
    expect(downs).toBe(0);
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1);
  });

  it('closing it during a wait cancels the attempt; a socket still connecting is closed as it opens', () => {
    start();
    last().drop();
    conn.close();
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1);

    start();
    const connecting = last();
    conn.close();
    connecting.open();
    expect(connecting.closedByPage).toBe(true);
    expect(opened).toHaveLength(0); // not handed out
    expect(downs).toBe(1);          // (the first one's drop)
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(2);
  });

  it('replaces a socket that went silent (a dead link that never fired close)', () => {
    start();
    const first = last();
    first.open();
    for (let i = 0; i < 6; i++) { vi.advanceTimersByTime(5000); first.hear(); } // the server's pings
    expect(first.closedByPage).toBe(false);

    vi.advanceTimersByTime(25_000);         // nothing for 25 s
    expect(first.closedByPage).toBe(true);
    expect(downs).toBe(1);
    vi.advanceTimersByTime(500);
    expect(sockets).toHaveLength(2);
  });

  it('gives a page woken from a freeze a moment before calling its socket dead', () => {
    start();
    const first = last();
    first.open();
    vi.setSystemTime(Date.now() + 120_000); // frozen: the clock moved, no timer ran
    vi.advanceTimersByTime(5000);           // the first tick after waking
    expect(first.closedByPage).toBe(false);
    first.hear();                           // what waited in the queue
    vi.advanceTimersByTime(15_000);
    expect(first.closedByPage).toBe(false);

    vi.setSystemTime(Date.now() + 120_000); // frozen again, and the link died meanwhile
    vi.advanceTimersByTime(15_000);         // 12 s to answer from the first tick (the server pings every 5 s)
    expect(first.closedByPage).toBe(false);
    vi.advanceTimersByTime(5000);
    expect(first.closedByPage).toBe(true);
  });

  it('does not reconnect while the page goes away, and does once it is shown again', () => {
    start();
    last().open();
    win.dispatchEvent(new Event('pagehide'));
    last().drop();                          // the browser closes it with the page
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1);
    win.dispatchEvent(new Event('pageshow')); // back from the back/forward cache
    expect(sockets).toHaveLength(2);
  });

  it('back online, or shown again, it tries at once instead of sitting out the wait', () => {
    start();
    for (let i = 0; i < 5; i++) { last().drop(); vi.advanceTimersByTime(10_000); }
    last().drop();                          // a 10 s wait now
    win.dispatchEvent(new Event('online'));
    expect(sockets).toHaveLength(7);
    win.dispatchEvent(new Event('online')); // already connecting: nothing more
    expect(sockets).toHaveLength(7);

    last().drop();
    win.document.dispatchEvent(new Event('visibilitychange'));
    expect(sockets).toHaveLength(8);
    vi.advanceTimersByTime(60_000);         // the wait it cut short does not open another
    expect(sockets.filter(s => s.readyState !== 3)).toHaveLength(1);
  });
});

describe('sendVideoTime', () => {
  it("carries the video's length once the player knows it, and leaves it out before", () => {
    const sent = [];
    const mockWs = { sendObj: obj => sent.push(obj) };
    let now = 10_000;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
    try {
      sendVideoTime(mockWs, { videoTime: 0, isPlaying: false, duration: 0 }); // not loaded yet
      now += 400;
      sendVideoTime(mockWs, { videoTime: 1, isPlaying: true, duration: undefined });
      now += 400;
      sendVideoTime(mockWs, { videoTime: 2, isPlaying: true, duration: 165.2 });
      now += 100;
      sendVideoTime(mockWs, { videoTime: 2.1, isPlaying: true, duration: 165.2 }); // throttled
    } finally { clock.mockRestore(); }
    expect(sent.map(m => m.data)).toEqual([
      { videoTime: 0, isPlaying: false },
      { videoTime: 1, isPlaying: true },
      { videoTime: 2, isPlaying: true, duration: 165.2 },
    ]);
  });
});

describe('sendPartyJoin', () => {
  it('carries the duet part and the browser guest id, so a rejoin keeps both', () => {
    const sent = [];
    const mockWs = { sendObj: obj => sent.push(obj) };
    sendPartyJoin(mockWs, { partyId: 'ABCD', username: 'Kim', isShowingVideo: false, color: 120, part: 2 });
    expect(sent[0].type).toBe('party:join');
    expect(sent[0].data).toMatchObject({ partyId: 'ABCD', username: 'Kim', isShowingVideo: false, color: 120, part: 2 });
    expect(typeof sent[0].data.guestId).toBe('string');
    expect('pageGuestId' in sent[0].data).toBe(false);
  });

  it("another microphone of the page brings its own guest id and the page's, which lets it into a closed party", () => {
    const sent = [];
    sendPartyJoin({ sendObj: obj => sent.push(obj) }, { partyId: 'ABCD', username: 'Mic 2', isShowingVideo: false, guestId: 'mic-x', extra: true });
    expect(sent[0].data).toMatchObject({ guestId: 'mic-x', extra: true, pageGuestId: getGuestId() });
  });
});

describe('host and co-host messages', () => {
  const capture = (fn) => { const sent = []; fn({ sendObj: obj => sent.push(obj) }); return sent; };

  it('advance and skip name the song they leave; without one, as before', () => {
    expect(capture(ws => sendSongAdvance(ws, 'abc'))).toEqual([{ type: 'song:advance', data: { from: 'abc' } }]);
    expect(capture(ws => sendSongSkip(ws, 'abc'))).toEqual([{ type: 'song:skip', data: { from: 'abc' } }]);
    expect(capture(ws => sendSongSkip(ws))).toEqual([{ type: 'song:skip', data: {} }]);
  });

  it("a co-host's playback control carries only what its action needs", () => {
    expect(capture(ws => sendPlaybackControl(ws, { action: 'pause', time: 3 }))).toEqual([{ type: 'playback:control', data: { action: 'pause' } }]);
    expect(capture(ws => sendPlaybackControl(ws, { action: 'seek', time: 42.5 }))).toEqual([{ type: 'playback:control', data: { action: 'seek', time: 42.5 } }]);
    expect(capture(ws => sendPlaybackControl(ws, { action: 'duet', on: 1 }))).toEqual([{ type: 'playback:control', data: { action: 'duet', on: true } }]);
  });

  it('co-hosts and the joining switch', () => {
    expect(capture(ws => sendCohost(ws, { username: 'Ann', on: true }))).toEqual([{ type: 'party:cohost', data: { username: 'Ann', on: true } }]);
    expect(capture(ws => sendPartySettings(ws, { joiningOpen: false }))).toEqual([{ type: 'party:settings', data: { joiningOpen: false } }]);
  });
});

describe('sendQueueReorder', () => {
  it('names the indexes the way the server reads them', () => {
    const sent = [];
    sendQueueReorder({ sendObj: obj => sent.push(obj) }, { from: 2, to: 0 });
    expect(sent).toEqual([{ type: 'queue:reorder', data: { fromIndex: 2, toIndex: 0 } }]);
  });
});

describe('Binary WebSocket protocol', () => {
  describe('sendPlayerNote', () => {
    it('sends a 10-byte ArrayBuffer with correct header, payload and flags', () => {
      let sentData = null;
      const mockWs = { send: data => { sentData = data; } };

      sendPlayerNote(mockWs, { freq: 440.5, videoTime: 12.25 });

      expect(sentData).toBeInstanceOf(ArrayBuffer);
      expect(sentData.byteLength).toBe(10);

      const view = new DataView(sentData);
      expect(view.getUint8(0)).toBe(BIN_PLAYER_NOTE);
      expect(view.getFloat32(1, true)).toBeCloseTo(440.5, 1);
      expect(view.getFloat32(5, true)).toBeCloseTo(12.25, 2);
      expect(view.getUint8(9)).toBe(0);

      // a window with a hissed consonant and no pitch
      sendPlayerNote(mockWs, { freq: 0, videoTime: 12.28, fric: 1 });
      expect(new DataView(sentData).getUint8(9)).toBe(1);
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

    it('decodes a standing message', () => {
      const buf = new ArrayBuffer(7);
      const view = new DataView(buf);
      view.setUint8(0, 0x04); view.setUint16(1, 37, true); view.setUint16(3, 120, true); view.setUint16(5, 4120, true);
      expect(parseStanding(buf)).toEqual({ rank: 37, total: 120, score: 4120 });
    });

    it('decodes the score that rides on each note in a v2 batch', () => {
      // [0x03][count][nameLen][name][freq f32][videoTime f32][score u16]
      const name = new TextEncoder().encode('jan');
      const buf = new ArrayBuffer(2 + 1 + name.length + 10);
      const view = new DataView(buf);
      view.setUint8(0, 0x03); view.setUint8(1, 1);
      view.setUint8(2, name.length); new Uint8Array(buf).set(name, 3);
      let o = 3 + name.length;
      view.setFloat32(o, 440, true); o += 4;
      view.setFloat32(o, 12.25, true); o += 4;
      view.setUint16(o, 7350, true);
      const { data } = parseBinaryBatch(buf);
      expect(data.notes).toEqual([{ username: 'jan', freq: 440, videoTime: 12.25, score: 7350 }]);
    });

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
