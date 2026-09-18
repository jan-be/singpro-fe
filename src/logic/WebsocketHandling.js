// Same origin as the page (ws for http, wss for https), so the dev server,
// `vite preview` and production all reach the backend through /api/ws.
const wsUrl = typeof window !== 'undefined'
  ? `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/api/ws`
  : '';

// --- Binary protocol constants ---
// High-frequency pitch messages use a compact binary format to reduce
// JSON parse overhead and payload size (~9 bytes vs ~65 bytes per note).
export const BIN_PLAYER_NOTE = 0x01;       // client → server
export const BIN_NOTES_BATCH = 0x02;       // server → client: notes only (a server from before the score rode along)
export const BIN_NOTES_BATCH_V2 = 0x03;    // server → client: each note with the singer's score
export const BIN_STANDING = 0x04;          // server → client: your own rank once the party outgrew its lanes

/** Decode a binary player:standing message: [0x04][rank u16 LE][singers u16 LE][score u16 LE]. */
export const parseStanding = (buffer) => {
  const view = new DataView(buffer);
  return { rank: view.getUint16(1, true), total: view.getUint16(3, true), score: view.getUint16(5, true) };
};

// Reusable buffer for sendPlayerNote (avoids allocation per call)
const _noteBuffer = new ArrayBuffer(9);
const _noteView = new DataView(_noteBuffer);
_noteView.setUint8(0, BIN_PLAYER_NOTE);

/**
 * Open a WebSocket and attach a `sendObj` helper. Resolves when connection is open.
 * The server answers party:join immediately, before the page has installed
 * its message handler (that happens a render later), so until then every
 * message is kept in `backlog`; the handler replays it when it takes over.
 */
export const openWebSocket = () => new Promise((resolve) => {
  const wss = new WebSocket(wsUrl);
  wss.binaryType = 'arraybuffer'; // receive binary as ArrayBuffer
  wss.sendObj = obj => wss.send(JSON.stringify(obj));
  wss.backlog = [];
  wss.onmessage = e => wss.backlog.push(e);
  wss.onopen = () => resolve(wss);
});

export const sendPartyJoin = (ws, { partyId, username, isShowingVideo, color }) => {
  ws.sendObj({
    type: "party:join",
    data: { partyId, username, isShowingVideo, color },
  });
};

/** Leave the party for good (a closed socket alone counts as a reload). */
export const sendPartyLeave = (ws) => {
  ws.send(JSON.stringify({ type: "party:leave", data: {} }));
};

/** Host: off to the menu — the party stays open, joiners are told to wait. */
export const sendHostAway = (ws) => {
  ws.send(JSON.stringify({ type: "party:host_away", data: {} }));
};

/** Host: end the party — everyone else is sent home. */
export const sendPartyClose = (ws) => {
  ws.send(JSON.stringify({ type: "party:close", data: {} }));
};

export const sendPlayerColor = (ws, { color }) => {
  ws.sendObj({ type: "player:color", data: { color } });
};

export const sendQueueAdd = (ws, { songId, artist, title, videoId }) => {
  ws.sendObj({
    type: "queue:add",
    data: { songId, artist, title, videoId },
  });
};

export const sendQueueRemove = (ws, { index }) => {
  ws.sendObj({
    type: "queue:remove",
    data: { index },
  });
};

export const sendQueueReorder = (ws, { from, to }) => {
  ws.sendObj({
    type: "queue:reorder",
    data: { from, to },
  });
};

export const sendPlayerNote = (ws, { freq, videoTime }) => {
  // Binary: [0x01][freq f32 LE][videoTime f32 LE] = 9 bytes
  _noteView.setFloat32(1, freq, true);
  _noteView.setFloat32(5, videoTime, true);
  ws.send(_noteBuffer);
};

/**
 * Decode a binary player:notes_batch message.
 * Format: [0x03][count u8][for each: usernameLen u8, username utf8, freq f32 LE, videoTime f32 LE, score u16 LE]
 *         [0x02] is the same without the score (a server from before it rode along).
 * Returns: { type: 'player:notes_batch', data: { notes: [{username, freq, videoTime, score?}, ...] } }
 */
export const parseBinaryBatch = (buffer) => {
  const view = new DataView(buffer);
  const withScore = view.getUint8(0) === BIN_NOTES_BATCH_V2;
  const count = view.getUint8(1);
  const notes = [];
  let offset = 2;
  const decoder = new TextDecoder();
  for (let i = 0; i < count; i++) {
    const nameLen = view.getUint8(offset); offset++;
    const nameBytes = new Uint8Array(buffer, offset, nameLen);
    const username = decoder.decode(nameBytes); offset += nameLen;
    const freq = view.getFloat32(offset, true); offset += 4;
    const videoTime = view.getFloat32(offset, true); offset += 4;
    const note = { username, freq, videoTime };
    if (withScore) { note.score = view.getUint16(offset, true); offset += 2; }
    notes.push(note);
  }
  return { type: 'player:notes_batch', data: { notes } };
};

export const sendSongStart = (ws, { songId, artist, title, videoId }) => {
  ws.sendObj({
    type: "song:start",
    data: { songId, artist, title, videoId },
  });
};

export const sendSongEnd = (ws) => {
  ws.sendObj({ type: "song:end" });
};

export const sendSongAdvance = (ws) => {
  ws.sendObj({ type: "song:advance" });
};

/** Host: skip the current song (next queued or a similar song starts, no score screen). */
export const sendSongSkip = (ws) => {
  ws.sendObj({ type: "song:skip" });
};

export const sendCountdownCancel = (ws) => {
  ws.sendObj({ type: "song:countdown_cancel" });
};

export const sendSongLyrics = (ws, { lyrics, gap }) => {
  ws.sendObj({
    type: "song:lyrics",
    data: { lyrics, gap },
  });
};

// Throttled video time sender (max 3/sec)
let lastVideoTimeSent = 0;
/** Host: the timing (gap, ms) changed — server scoring and joiners follow. */
export const sendSongGap = (ws, { gap }) => {
  ws.send(JSON.stringify({
    type: "song:gap",
    data: { gap },
  }));
};

export const sendVideoTime = (ws, { videoTime, isPlaying }) => {
  const now = performance.now();
  if (now - lastVideoTimeSent < 333) return; // ~3/sec
  lastVideoTimeSent = now;
  ws.sendObj({
    type: "video:time",
    data: { videoTime, isPlaying },
  });
};

export const sendPingReply = (ws, { serverTs }) => {
  ws.sendObj({
    type: "ping:reply",
    data: { serverTs },
  });
};
