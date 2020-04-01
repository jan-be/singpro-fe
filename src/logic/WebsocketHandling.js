const apiDomain = `api.${window.location.hostname}`;
const wsUrl = `wss://${apiDomain}/ws`;

export const openWebSocket = options => new Promise((resolve) => {
  const wss = new WebSocket(wsUrl);
  wss.sendObj = obj => wss.send(JSON.stringify(obj));
  wss.onopen = () => {
    wss.sendObj({
      type: "meta",
      data: { status: "connected", ...options }
    });
    resolve(wss);
  }
});
