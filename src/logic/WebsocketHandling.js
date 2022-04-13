const wsUrl = `wss://${window.location.hostname}/api/ws`;

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

export const sendVideoTime = (wss, songId, videoTime) => {
  wss.sendObj(
    { type: "videoTime", data: { songId, videoTime } },
  );
};
