const isDev = import.meta.env.DEV;
const wsUrl = isDev
  ? `ws://${window.location.host}/api/ws`
  : `wss://${window.location.hostname}/api/ws`;

// --- Legacy v1 API (backward compat) ---

export const openWebSocket = options => new Promise((resolve) => {
  const wss = new WebSocket(wsUrl);
  wss.sendObj = obj => wss.send(JSON.stringify(obj));
  wss.onopen = () => {
    wss.sendObj({
      type: "meta",
      data: { status: "connected", ...options },
    });
    resolve(wss);
  };
});

export const sendLastNote = (wss, note) => {
  wss.sendObj(
    { type: "note", data: { note } },
  );
};

export const sendVideoTime = (wss, songId, videoTime, isPlaying) => {
  wss.sendObj(
    { type: "videoTime", data: { songId, videoTime, isPlaying } },
  );
};

// --- v2 Protocol ---

export const sendPartyJoin = (ws, { partyId, username, isShowingVideo }) => {
  ws.sendObj({
    type: "party:join",
    data: { partyId, username, isShowingVideo },
  });
};

export const sendPartyLeave = (ws) => {
  ws.sendObj({ type: "party:leave" });
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

export const sendPlayerNote = (ws, { note, videoTime }) => {
  ws.sendObj({
    type: "player:note",
    data: { note, videoTime },
  });
};

export const sendPlayerReady = (ws) => {
  ws.sendObj({ type: "player:ready" });
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

export const sendSongLyrics = (ws, { lyrics, gap }) => {
  ws.sendObj({
    type: "song:lyrics",
    data: { lyrics, gap },
  });
};

// Throttled video time sender (max 3/sec)
let lastVideoTimeSent = 0;
export const sendVideoTimeV2 = (ws, { videoTime, isPlaying }) => {
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
