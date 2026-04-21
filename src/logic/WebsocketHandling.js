const isDev = import.meta.env.DEV;
const wsUrl = isDev
  ? `ws://${window.location.host}/api/ws`
  : `wss://${window.location.hostname}/api/ws`;

/** Open a WebSocket and attach a `sendObj` helper. Resolves when connection is open. */
export const openWebSocket = () => new Promise((resolve) => {
  const wss = new WebSocket(wsUrl);
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
  ws.sendObj({
    type: "player:note",
    data: { freq, videoTime },
  });
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
