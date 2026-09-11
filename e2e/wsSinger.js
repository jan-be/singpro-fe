/**
 * Synthetic singer for stress tests: speaks the party WebSocket protocol from
 * Node without a browser. Joins the party, follows the host's video time, and
 * streams binary pitch notes at the real client's rate (one every 60 ms) with a
 * slow vibrato around A3–A4 so scoring stays plausible. Replies to latency
 * pings like a real client. Uses Node's built-in WebSocket (Node >= 22).
 *
 * Cheap enough to run dozens at once, which is how you push the *real*
 * browsers' note rendering further than one machine can run Chrome contexts.
 */
const BIN_PLAYER_NOTE = 0x01;
const BIN_NOTES_BATCH = 0x02;

export function startBotSinger({ url, partyId, username, noteIntervalMs = 60 }) {
  const stats = { username, sentNotes: 0, receivedBatches: 0, receivedNotes: 0, pings: 0, errors: [], closed: false };
  const ws = new WebSocket(url);
  ws.binaryType = 'arraybuffer';

  // Video clock: anchored to the host's last video:time, advanced locally
  let hostTime = 0;
  let hostAt = Date.now();
  const videoTime = () => hostTime + (Date.now() - hostAt) / 1000;

  const note = new ArrayBuffer(9);
  const view = new DataView(note);
  view.setUint8(0, BIN_PLAYER_NOTE);
  let phase = 0;
  let timer = null;

  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ type: 'party:join', data: { partyId, username, isShowingVideo: false, color: 200 } }));
      timer = setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN) return;
        phase += 0.15;
        const freq = 330 * Math.pow(2, Math.sin(phase) * 0.5); // ~233–466 Hz
        view.setFloat32(1, freq, true);
        view.setFloat32(5, videoTime(), true);
        ws.send(note);
        stats.sentNotes++;
      }, noteIntervalMs);
      resolve();
    });
    ws.addEventListener('error', () => { stats.errors.push('socket error'); reject(new Error(`${username}: socket error`)); });
  });

  ws.addEventListener('message', (ev) => {
    if (typeof ev.data === 'string') {
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      if (m.type === 'ping:request') {
        ws.send(JSON.stringify({ type: 'ping:reply', data: { serverTs: m.data.serverTs } }));
        stats.pings++;
      } else if (m.type === 'video:time') {
        hostTime = m.data.videoTime;
        hostAt = Date.now();
      } else if (m.type === 'error') {
        stats.errors.push(m.data?.message ?? 'error');
      }
    } else if (ev.data instanceof ArrayBuffer) {
      const v = new DataView(ev.data);
      if (v.byteLength > 1 && v.getUint8(0) === BIN_NOTES_BATCH) {
        stats.receivedBatches++;
        stats.receivedNotes += v.getUint8(1);
      }
    }
  });
  ws.addEventListener('close', () => { stats.closed = true; clearInterval(timer); });

  return {
    stats,
    ready,
    close: () => { clearInterval(timer); try { ws.close(); } catch { /* */ } },
  };
}
