import { getGuestId } from './sessionId';

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

/** A message to the server (sendObj) */
export interface ClientMessage {
  type: string;
  data?: unknown;
}

/**
 * The party's socket (createSocket): a WebSocket with `sendObj`, and the
 * messages that came before the page's handler took over
 */
export interface PartySocket extends WebSocket {
  sendObj(obj: ClientMessage): void;
  backlog: MessageEvent[];
}

/** What a sender that sends JSON needs of the socket */
export type ObjSocket = Pick<PartySocket, 'sendObj'>;
/** What a sender that writes the frame itself needs of the socket */
export type RawSocket = Pick<WebSocket, 'send'>;

/** Your own rank once the party outgrew its lanes (player:standing) */
export interface Standing {
  rank: number;
  total: number;
  score: number;
}

/** Decode a binary player:standing message: [0x04][rank u16 LE][singers u16 LE][score u16 LE]. */
export const parseStanding = (buffer: ArrayBuffer): Standing => {
  const view = new DataView(buffer);
  return { rank: view.getUint16(1, true), total: view.getUint16(3, true), score: view.getUint16(5, true) };
};

// Reusable buffer for sendPlayerNote (avoids allocation per call)
const _noteBuffer = new ArrayBuffer(10);
const _noteView = new DataView(_noteBuffer);
_noteView.setUint8(0, BIN_PLAYER_NOTE);

const OPEN = 1; // WebSocket.OPEN

/**
 * A WebSocket with a `sendObj` helper. The server answers party:join
 * immediately, before the page has installed its message handler (that
 * happens a render later), so until then every message is kept in `backlog`;
 * the handler replays it when it takes over.
 */
const createSocket = (): PartySocket => {
  const wss = new WebSocket(wsUrl) as PartySocket; // (sendObj and backlog are added here)
  wss.binaryType = 'arraybuffer'; // receive binary as ArrayBuffer
  // A socket that dropped takes nothing more (the browser would warn about
  // every message); the next one is told what matters when it opens
  wss.sendObj = obj => { if (wss.readyState === OPEN) wss.send(JSON.stringify(obj)); };
  wss.backlog = [];
  wss.onmessage = e => wss.backlog.push(e);
  return wss;
};

export const RECONNECT_FIRST_MS = 500;
export const RECONNECT_MAX_MS = 10_000;

/**
 * The wait before reconnect attempt `n` (0 first): 0.5 s, 1 s, 2 s … at most
 * 10 s, each ±25 % so a party's phones do not all knock at the same moment
 * after a server restart.
 */
export const reconnectDelay = (n: number, random: () => number = Math.random): number =>
  Math.round(Math.min(RECONNECT_MAX_MS, RECONNECT_FIRST_MS * 2 ** n) * (0.75 + 0.5 * random()));

const STABLE_MS = 10_000;  // open this long: the next drop starts from the first, short wait again
const STALE_MS = 20_000;   // nothing heard for this long (the server pings every 5 s): the link is dead
const PROBE_MS = 12_000;   // after the page was frozen or throttled: time for the link to show it lives
const WATCH_MS = 5_000;

/** keepWebSocket's callbacks, and what tests replace */
export interface KeepWebSocketOptions {
  onOpen: (ws: PartySocket, info: { reconnect: boolean }) => void;
  onDown?: () => void;
  create?: () => PartySocket;
  win?: Window | null;
  random?: () => number;
}

/** The kept connection (keepWebSocket) */
export interface KeptWebSocket {
  close(): void;
}

/**
 * The party's socket, kept open: a socket that drops (a proxy restart, Wi-Fi,
 * a phone that slept, a change of mobile network) is replaced after
 * reconnectDelay, and one that stays silent past STALE_MS counts as dropped,
 * since a dead link often never fires `close`. `onOpen(ws, { reconnect })`
 * runs for every socket that opens (send the join from there); `onDown()`
 * whenever one dropped or could not be opened. Nothing reconnects once
 * `close()` was called, nor while the page is going away (pagehide; a page
 * back from the back/forward cache connects again).
 * `create`, `win` and `random` are for tests.
 */
export const keepWebSocket = ({
  onOpen,
  onDown = () => {},
  create = createSocket,
  win = typeof window !== 'undefined' ? window : null,
  random = Math.random,
}: KeepWebSocketOptions): KeptWebSocket => {
  let ws: PartySocket | null = null;       // the socket being opened, or open
  let opened = false;  // whether `ws` has opened
  let openedAt = 0;
  let heardAt = 0;     // its last message
  let attempt = 0;
  let everOpened = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let leaving = false; // pagehide
  let watchedAt = Date.now();

  const lost = (sock: PartySocket) => {
    if (sock !== ws) return; // replaced or closed on purpose
    ws = null;
    if (opened && Date.now() - openedAt >= STABLE_MS) attempt = 0;
    opened = false;
    onDown();
    if (!stopped && !leaving && !timer) timer = setTimeout(connect, reconnectDelay(attempt++, random));
  };

  function connect() {
    clearTimeout(timer);
    timer = null;
    if (stopped || leaving || ws) return;
    const sock = create();
    ws = sock;
    opened = false;
    sock.addEventListener('open', () => {
      if (sock !== ws) return;
      opened = true;
      openedAt = heardAt = Date.now();
      const reconnect = everOpened;
      everOpened = true;
      onOpen(sock, { reconnect });
    });
    sock.addEventListener('message', () => { if (sock === ws) heardAt = Date.now(); });
    sock.addEventListener('close', () => lost(sock)); // (an error is followed by a close)
  }

  const watch = setInterval(() => {
    const now = Date.now();
    // A late tick means the page was frozen (a phone asleep) or throttled in
    // the background: what arrived meanwhile may still wait in the queue, so
    // the link gets a little time to show it is alive instead of being cut
    if (now - watchedAt > 3 * WATCH_MS) heardAt = Math.max(heardAt, now - STALE_MS + PROBE_MS);
    watchedAt = now;
    if (ws && opened && now - heardAt > STALE_MS) {
      const sock = ws;
      lost(sock);
      try { sock.close(); } catch { /* */ }
    }
  }, WATCH_MS);

  // Back online, or a phone woken up: no need to sit out the rest of a wait
  const nudge = () => { if (!ws) connect(); };
  const onVisible = () => { if (win?.document?.visibilityState === 'visible') nudge(); };
  const onPageHide = () => { leaving = true; clearTimeout(timer); timer = null; };
  const onPageShow = () => { if (leaving) { leaving = false; nudge(); } };
  win?.addEventListener('online', nudge);
  win?.addEventListener('pagehide', onPageHide);
  win?.addEventListener('pageshow', onPageShow);
  win?.document?.addEventListener('visibilitychange', onVisible);

  connect();

  return {
    /** For good (the page closes, the party was left or is gone): the socket closes, nothing reconnects. */
    close() {
      stopped = true;
      clearTimeout(timer);
      clearInterval(watch);
      win?.removeEventListener('online', nudge);
      win?.removeEventListener('pagehide', onPageHide);
      win?.removeEventListener('pageshow', onPageShow);
      win?.document?.removeEventListener('visibilitychange', onVisible);
      const sock = ws;
      ws = null;
      // One still connecting is closed once it opens: closed before, the
      // browser logs an error (React's dev mode mounts every page twice)
      if (sock?.readyState === 0) sock.addEventListener('open', () => sock.close());
      else try { sock?.close(); } catch { /* */ }
    },
  };
};

/** party:join (sendPartyJoin) */
export interface PartyJoin {
  partyId: string;
  username: string;
  isShowingVideo: boolean;
  /** the singer's hue */
  color?: number | null;
  /** the duet part sung, 1 or 2 */
  part?: number | null;
  guestId?: string;
  /** another microphone of this page (extraSingers.js) */
  extra?: boolean;
}

/** party:settings, each optional (sendPartySettings) */
export interface PartySettings {
  joiningOpen?: boolean;
  autoSkip?: boolean;
}

/** What a co-host has the host's page do (playback:control) */
export type PlaybackAction = 'play' | 'pause' | 'seek' | 'duet';

/** queue:add (sendQueueAdd) */
export interface QueueAdd {
  songId: string;
  artist: string;
  title: string;
  videoId: string;
  /** queue-search | queue-similar | sing-again */
  source?: string;
  searchId?: string | null;
}

/** song:start (sendSongStart) */
export interface SongStart {
  songId: string;
  artist: string;
  title: string;
  videoId: string;
}

/** One note of a player:notes_batch: whose, its pitch (Hz) and video time (s), and the singer's score (v2) */
export interface BatchNote {
  username: string;
  freq: number;
  videoTime: number;
  score?: number;
}

/** A binary player:notes_batch, decoded (parseBinaryBatch) */
export interface NotesBatchMessage {
  type: 'player:notes_batch';
  data: { notes: BatchNote[] };
}

// The browser's guest id goes along: a guest's scores are saved under it until
// this browser signs in and they become the account's (sessionId.js). So does
// the duet part this singer picked, so a rejoin keeps scoring them against it.
// An extra microphone of this page (extraSingers.js) brings its own guest id and
// `extra`: the server then leaves the page's account off its seat. The page's
// guest id goes along with it, which lets it in while the party is closed to
// new people: a microphone of a page already in the party is no newcomer.
export const sendPartyJoin = (ws: ObjSocket, { partyId, username, isShowingVideo, color, part, guestId, extra }: PartyJoin) => {
  ws.sendObj({
    type: "party:join",
    data: { partyId, username, isShowingVideo, color, part, guestId: guestId ?? getGuestId(), ...(extra ? { extra: true, pageGuestId: getGuestId() } : {}) },
  });
};

/** Host or co-host: make `username` a co-host (on) or not. The server tells every page (party:settings). */
export const sendCohost = (ws: ObjSocket, { username, on }: { username: string; on: boolean }) => {
  ws.sendObj({ type: "party:cohost", data: { username, on: !!on } });
};

/**
 * Host or co-host: the party's settings, each optional: whether new people may
 * join by the QR code or the link, and the host page's auto-skip (that page
 * reports its own when it joins). A server from before ignores the message.
 */
export const sendPartySettings = (ws: ObjSocket, settings: PartySettings) => {
  ws.sendObj({ type: "party:settings", data: settings });
};

/**
 * Co-host: what the host's page plays — 'play', 'pause', 'seek' (time, s) or
 * 'duet' (on). Done there: that page plays the video and the music.
 */
export const sendPlaybackControl = (ws: ObjSocket, { action, time, on }: { action: PlaybackAction; time?: number; on?: boolean }) => {
  ws.sendObj({
    type: "playback:control",
    data: { action, ...(action === 'seek' ? { time } : {}), ...(action === 'duet' ? { on: !!on } : {}) },
  });
};

/** Leave the party for good (a closed socket alone counts as a reload). */
export const sendPartyLeave = (ws: RawSocket) => {
  ws.send(JSON.stringify({ type: "party:leave", data: {} }));
};

/** Host: off to the menu — the party stays open, joiners are told to wait. */
export const sendHostAway = (ws: RawSocket) => {
  ws.send(JSON.stringify({ type: "party:host_away", data: {} }));
};

/** Host: end the party — everyone else is sent home. */
export const sendPartyClose = (ws: RawSocket) => {
  ws.send(JSON.stringify({ type: "party:close", data: {} }));
};

export const sendPlayerColor = (ws: ObjSocket, { color }: { color: number }) => {
  ws.sendObj({ type: "player:color", data: { color } });
};

// source (queue-search | queue-similar) and the search session are for the admin statistics
export const sendQueueAdd = (ws: ObjSocket, { songId, artist, title, videoId, source, searchId }: QueueAdd) => {
  ws.sendObj({
    type: "queue:add",
    data: { songId, artist, title, videoId, ...(source ? { source } : {}), ...(searchId ? { searchId } : {}) },
  });
};

/**
 * A song whose chart is being made (POST /chart-jobs first): the queue shows
 * it at once and plays it when it is ready. videoTitle is shown until the
 * server knows the song's name. A server from before ignores the message.
 */
export const sendQueueAddJob = (ws: ObjSocket, { jobId, videoTitle }: { jobId: number; videoTitle?: string | null }) => {
  ws.sendObj({
    type: "queue:add_job",
    data: { jobId, ...(videoTitle ? { videoTitle: String(videoTitle).slice(0, 200) } : {}) },
  });
};

export const sendQueueRemove = (ws: ObjSocket, { index }: { index: number }) => {
  ws.sendObj({
    type: "queue:remove",
    data: { index },
  });
};

// The server reads fromIndex / toIndex; with { from, to } it moved nothing
// and sent the unchanged queue back, so no reorder ever took.
export const sendQueueReorder = (ws: ObjSocket, { from, to }: { from: number; to: number }) => {
  ws.sendObj({
    type: "queue:reorder",
    data: { fromIndex: from, toIndex: to },
  });
};

/**
 * Binary: [0x01][freq f32 LE][videoTime f32 LE][flags u8] = 10 bytes.
 * flags bit 0: the window held a hissed consonant (fricative.js). A server
 * from before the flags byte reads the first 9 bytes and ignores it.
 */
export const sendPlayerNote = (ws: Pick<WebSocket, 'send' | 'readyState'>, { freq, videoTime, fric = 0 }: { freq: number; videoTime: number; fric?: number | boolean }) => {
  if (ws.readyState > OPEN) return; // dropped (closing or closed): a new socket is on its way
  _noteView.setFloat32(1, freq, true);
  _noteView.setFloat32(5, videoTime, true);
  _noteView.setUint8(9, fric ? 1 : 0);
  ws.send(_noteBuffer);
};

/**
 * Decode a binary player:notes_batch message.
 * Format: [0x03][count u8][for each: usernameLen u8, username utf8, freq f32 LE, videoTime f32 LE, score u16 LE]
 *         [0x02] is the same without the score (a server from before it rode along).
 * Returns: { type: 'player:notes_batch', data: { notes: [{username, freq, videoTime, score?}, ...] } }
 */
export const parseBinaryBatch = (buffer: ArrayBuffer): NotesBatchMessage => {
  const view = new DataView(buffer);
  const withScore = view.getUint8(0) === BIN_NOTES_BATCH_V2;
  const count = view.getUint8(1);
  const notes: BatchNote[] = [];
  let offset = 2;
  const decoder = new TextDecoder();
  for (let i = 0; i < count; i++) {
    const nameLen = view.getUint8(offset); offset++;
    const nameBytes = new Uint8Array(buffer, offset, nameLen);
    const username = decoder.decode(nameBytes); offset += nameLen;
    const freq = view.getFloat32(offset, true); offset += 4;
    const videoTime = view.getFloat32(offset, true); offset += 4;
    const note: BatchNote = { username, freq, videoTime };
    if (withScore) { note.score = view.getUint16(offset, true); offset += 2; }
    notes.push(note);
  }
  return { type: 'player:notes_batch', data: { notes } };
};

export const sendSongStart = (ws: ObjSocket, { songId, artist, title, videoId }: SongStart) => {
  ws.sendObj({
    type: "song:start",
    data: { songId, artist, title, videoId },
  });
};

export const sendSongEnd = (ws: ObjSocket) => {
  ws.sendObj({ type: "song:end" });
};

// `from`: the song on stage when it was asked for. Where the host and a
// co-host both ask, the second one finds another song on and is ignored.
export const sendSongAdvance = (ws: ObjSocket, from?: string | null) => {
  ws.sendObj({ type: "song:advance", data: from ? { from } : {} });
};

/** Host or co-host: skip the current song `from` (next queued or a similar song starts, no score screen). */
export const sendSongSkip = (ws: ObjSocket, from?: string | null) => {
  ws.sendObj({ type: "song:skip", data: from ? { from } : {} });
};

export const sendCountdownCancel = (ws: ObjSocket) => {
  ws.sendObj({ type: "song:countdown_cancel" });
};

/** Which of a duet's two parts I sing (1 or 2): the server scores me against it and tells the others. */
export const sendPlayerPart = (ws: ObjSocket, part: number) => {
  ws.sendObj({ type: "player:part", data: { part } });
};

export const sendSongLyrics = (ws: ObjSocket, { lyrics, gap }: { lyrics: string; gap: number | null }) => {
  ws.sendObj({
    type: "song:lyrics",
    data: { lyrics, gap },
  });
};

// Throttled video time sender (max 3/sec)
let lastVideoTimeSent = 0;
/** Host: the timing (gap, ms) changed — server scoring and joiners follow. */
export const sendSongGap = (ws: RawSocket, { gap }: { gap: number }) => {
  ws.send(JSON.stringify({
    type: "song:gap",
    data: { gap },
  }));
};

export const sendVideoTime = (ws: ObjSocket, { videoTime, isPlaying, duration }: { videoTime: number; isPlaying: boolean; duration?: number }) => {
  const now = performance.now();
  if (now - lastVideoTimeSent < 333) return; // ~3/sec
  lastVideoTimeSent = now;
  ws.sendObj({
    type: "video:time",
    // duration: the video's length in s, once the player knows it (optional: older servers relay it, older clients ignore it)
    data: { videoTime, isPlaying, ...(duration! > 0 ? { duration } : {}) }, // (undefined > 0 is false)
  });
};

export const sendPingReply = (ws: ObjSocket, { serverTs }: { serverTs: number }) => {
  ws.sendObj({
    type: "ping:reply",
    data: { serverTs },
  });
};
