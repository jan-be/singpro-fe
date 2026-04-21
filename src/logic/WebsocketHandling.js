const isDev = import.meta.env.DEV;
const wsUrl = typeof window !== 'undefined'
  ? (isDev
    ? `ws://${window.location.host}/api/ws`
    : `wss://${window.location.hostname}/api/ws`)
  : '';

// --- Binary protocol constants ---
// High-frequency pitch messages use a compact binary format to reduce
// JSON parse overhead and payload size (~9 bytes vs ~65 bytes per note).
export const BIN_PLAYER_NOTE = 0x01;       // client → server
export const BIN_NOTES_BATCH = 0x02;       // server → client

// Reusable buffer for sendPlayerNote (avoids allocation per call)
const _noteBuffer = new ArrayBuffer(9);
const _noteView = new DataView(_noteBuffer);
_noteView.setUint8(0, BIN_PLAYER_NOTE);

/** Open a WebSocket and attach a `sendObj` helper. Resolves when connection is open. */
export const openWebSocket = () => new Promise((resolve) => {
  const wss = new WebSocket(wsUrl);
  wss.binaryType = 'arraybuffer'; // receive binary as ArrayBuffer
  wss.sendObj = obj => wss.send(JSON.stringify(obj));
  wss.onopen = () => resolve(wss);
});

export const sendPartyJoin = (ws, { partyId, username, isShowingVideo, color }) => {
  ws.sendObj({
    type: "party:join",
    data: { partyId, username, isShowingVideo, color },
  });
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
 * Format: [0x02][count u8][for each: usernameLen u8, username utf8, freq f32 LE, videoTime f32 LE]
 * Returns: { type: 'player:notes_batch', data: { notes: [{username, freq, videoTime}, ...] } }
 */
export const parseBinaryBatch = (buffer) => {
  const view = new DataView(buffer);
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
    notes.push({ username, freq, videoTime });
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
